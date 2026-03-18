import base64
import json
import os
import re
import time
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from api.schemas import ChartAnalysisRequest, ChatMessageRequest, ChatMessageResponse

router = APIRouter(prefix="/chat", tags=["chat"])

GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
DEFAULT_MODEL_CANDIDATES = [
    "gemini-2.5-flash",
    "gemini-3.0-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-flash-latest",
    "gemini-1.5-flash",
]
MAX_CONTINUATION_CALLS = 2
MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024
ALLOWED_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _extract_gemini_text(data: dict) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        return "I could not generate a response right now."

    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    if not parts:
        return "I could not generate a response right now."

    text_chunks = [
        str(part.get("text", "")).strip() for part in parts if part.get("text")
    ]
    text = "\n".join(chunk for chunk in text_chunks if chunk)
    if not text:
        return "I could not generate a response right now."
    return text.strip()


def _extract_finish_reason(data: dict) -> str:
    candidates = data.get("candidates") or []
    if not candidates:
        return ""
    return str(candidates[0].get("finishReason") or "").upper()


def _is_likely_truncated(text: str) -> bool:
    stripped = text.rstrip()
    if not stripped:
        return False
    return stripped[-1] not in {".", "!", "?", ")", '"', "'", "]", "}"}


def _sanitize_plain_text(text: str) -> str:
    cleaned = text.strip()
    cleaned = cleaned.replace("**", "")
    cleaned = cleaned.replace("__", "")
    cleaned = cleaned.replace("`", "")
    cleaned = re.sub(r"^\s*[-*]\s+", "- ", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned


def _extract_safety_flags(data: dict) -> list[str]:
    flags: set[str] = set()

    prompt_feedback = data.get("promptFeedback") or {}
    prompt_block_reason = prompt_feedback.get("blockReason")
    if prompt_block_reason:
        flags.add(str(prompt_block_reason).upper())

    candidates = data.get("candidates") or []
    if candidates:
        candidate = candidates[0] or {}
        finish_reason = candidate.get("finishReason")
        if finish_reason and str(finish_reason).upper() in {"SAFETY", "BLOCKLIST"}:
            flags.add(str(finish_reason).upper())

        safety_ratings = candidate.get("safetyRatings") or []
        for rating in safety_ratings:
            category = rating.get("category")
            probability = rating.get("probability")
            if (
                category
                and probability
                and str(probability).upper() not in {"NEGLIGIBLE", "LOW"}
            ):
                flags.add(f"{str(category).upper()}:{str(probability).upper()}")

    return sorted(flags)


def _build_grounding_block(series: list[dict], max_items: int = 5) -> str:
    if not series:
        return "Grounding\n- No chart points provided."

    grounding_lines: list[str] = []
    for point in series[:max_items]:
        compact = []
        for key, value in point.items():
            if isinstance(value, (str, int, float, bool)) or value is None:
                compact.append(f"{key}={value}")
        if compact:
            grounding_lines.append(f"- {', '.join(compact)}")

    if not grounding_lines:
        return "Grounding\n- Chart payload present but no scalar fields to cite."

    return "Grounding\n" + "\n".join(grounding_lines)


def _build_generation_body(
    user_parts: list[dict], *, temperature: float, max_output_tokens: int
) -> dict:
    base_system_instruction = {
        "parts": [
            {
                "text": (
                    "You are a helpful assistant for a cart-to-purchase prediction dashboard. "
                    "Keep answers concise and practical. "
                    "If image is provided, explain what you observe and what confidence caveats apply. "
                    "Return plain text only. Do not use markdown symbols such as **, __, #, or backticks."
                )
            }
        ]
    }

    return {
        "system_instruction": base_system_instruction,
        "contents": [
            {
                "role": "user",
                "parts": user_parts,
            }
        ],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": max_output_tokens,
        },
    }


async def _run_gemini_chat(user_parts: list[dict]) -> ChatMessageResponse:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="Missing GEMINI_API_KEY on server.")

    body = _build_generation_body(user_parts, temperature=0.4, max_output_tokens=900)

    params = {"key": api_key}
    preferred_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
    model_candidates = [preferred_model] if preferred_model else []
    model_candidates.extend(
        [m for m in DEFAULT_MODEL_CANDIDATES if m and m != preferred_model]
    )

    last_error_text = ""
    data: dict | None = None
    selected_model: str | None = None
    combined_reply = ""
    trace_id = f"chat_{uuid4().hex[:12]}"
    safety_flags: set[str] = set()
    started_at = time.perf_counter()

    async def _call_generate(current_body: dict) -> dict:
        nonlocal last_error_text, selected_model

        if selected_model:
            url = f"{GEMINI_API_BASE}/{selected_model}:generateContent"
            response = await client.post(url, params=params, json=current_body)
            response.raise_for_status()
            return response.json()

        for model in model_candidates:
            url = f"{GEMINI_API_BASE}/{model}:generateContent"
            response = await client.post(url, params=params, json=current_body)
            if response.status_code == 404:
                last_error_text = response.text
                continue
            response.raise_for_status()
            selected_model = model
            return response.json()

        raise HTTPException(
            status_code=502, detail="No compatible Gemini model found for this key."
        )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            data = await _call_generate(body)
            safety_flags.update(_extract_safety_flags(data))

            combined_reply = _extract_gemini_text(data)
            finish_reason = _extract_finish_reason(data)

            continuation_count = 0
            while continuation_count < MAX_CONTINUATION_CALLS and (
                finish_reason == "MAX_TOKENS" or _is_likely_truncated(combined_reply)
            ):
                continuation_prompt = (
                    "Continue exactly from where the previous answer stopped. "
                    "Do not repeat earlier text. Start immediately with the unfinished phrase.\n\n"
                    f"Previous partial answer:\n{combined_reply[-1000:]}"
                )
                continuation_body = _build_generation_body(
                    [{"text": continuation_prompt}],
                    temperature=0.2,
                    max_output_tokens=500,
                )
                continuation_data = await _call_generate(continuation_body)
                safety_flags.update(_extract_safety_flags(continuation_data))
                continuation_text = _extract_gemini_text(continuation_data)
                if not continuation_text:
                    break

                combined_reply = (
                    f"{combined_reply.rstrip()} {continuation_text.lstrip()}".strip()
                )
                finish_reason = _extract_finish_reason(continuation_data)
                continuation_count += 1
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502, detail=f"Gemini API error: {exc.response.text}"
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502, detail="Unable to reach Gemini API."
        ) from exc

    if data is None:
        detail = "No compatible Gemini model found for this key. Set GEMINI_MODEL or check enabled models."
        if last_error_text:
            detail = f"Gemini API error: {last_error_text}"
        raise HTTPException(status_code=502, detail=detail)

    reply_text = combined_reply or _extract_gemini_text(data)
    reply = _sanitize_plain_text(reply_text)
    latency_ms = int((time.perf_counter() - started_at) * 1000)
    return ChatMessageResponse(
        reply=reply,
        confidence=None,
        safety_flags=sorted(safety_flags),
        trace_id=trace_id,
        model=selected_model,
        latency_ms=latency_ms,
    )


@router.post("", response_model=ChatMessageResponse)
async def chat(payload: ChatMessageRequest) -> ChatMessageResponse:
    return await _run_gemini_chat([{"text": payload.message}])


@router.post("/image", response_model=ChatMessageResponse)
async def chat_image(
    message: str = Form(...),
    image: UploadFile = File(...),
) -> ChatMessageResponse:
    text = message.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Message cannot be empty.")

    if (
        not image.content_type
        or image.content_type.lower() not in ALLOWED_IMAGE_MIME_TYPES
    ):
        raise HTTPException(
            status_code=415, detail="Unsupported image type. Use PNG, JPEG, or WEBP."
        )

    file_bytes = await image.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded image is empty.")

    if len(file_bytes) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(
            status_code=413, detail="Image too large. Maximum size is 8MB."
        )

    encoded = base64.b64encode(file_bytes).decode("utf-8")
    parts = [
        {"text": text},
        {
            "inline_data": {
                "mime_type": image.content_type.lower(),
                "data": encoded,
            }
        },
    ]
    return await _run_gemini_chat(parts)


@router.post("/chart", response_model=ChatMessageResponse)
async def chat_chart(payload: ChartAnalysisRequest) -> ChatMessageResponse:
    safe_chart_type = payload.chart_type.strip()
    safe_title = payload.chart_title.strip() if payload.chart_title else safe_chart_type
    safe_question = payload.question.strip()
    if not safe_question:
        raise HTTPException(status_code=422, detail="Question cannot be empty.")

    compact_series = payload.series[:120]
    compact_context = payload.context

    chart_payload_text = json.dumps(
        {
            "chart_type": safe_chart_type,
            "chart_title": safe_title,
            "question": safe_question,
            "series": compact_series,
            "context": compact_context,
        },
        ensure_ascii=True,
    )

    prompt = (
        "Analyze the provided chart data from a cart-to-purchase dashboard. "
        "Ground every claim in the provided values only. "
        "If data is insufficient, clearly say what is missing. "
        "Return plain text with 4 short sections: Insight, Why, Recommended action, Grounding. "
        "Grounding section must cite at least 3 specific values from the provided series when available.\n\n"
        f"Chart payload:\n{chart_payload_text}"
    )
    response = await _run_gemini_chat([{"text": prompt}])
    if "grounding" not in response.reply.lower():
        fallback_grounding = _build_grounding_block(compact_series)
        response.reply = f"{response.reply.rstrip()}\n\n{fallback_grounding}".strip()
    return response


@router.options("")
async def chat_options() -> Response:
    return Response(status_code=204)


@router.options("/image")
async def chat_image_options() -> Response:
    return Response(status_code=204)


@router.options("/chart")
async def chat_chart_options() -> Response:
    return Response(status_code=204)
