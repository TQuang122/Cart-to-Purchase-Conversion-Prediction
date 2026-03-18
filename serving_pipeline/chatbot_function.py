import gradio as gr
import pandas as pd
import random
import time
import google.generativeai as genai
from dotenv import load_dotenv
import os

# pip install google-generativeai
initial_message = [
    {
        "role": "assistant",
        "content": "👋 Hi! I'm your **AI Growth Assistant**.\n\nCan I help you optimize your e-commerce today?"
    }
]
#================================


# === Get API key from env ======
load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel("gemini-3-flash-preview")
#================================




# --- 3. LOGIC CHATBOT ---

def build_prompt(message):
    prompt = f"""
    You are an AI assistant for an E-commerce Prediction System.

    User question:
    {message}

    Answer clearly, in bullet points if helpful.
    """
    return prompt

def chat_interface(message, history):
    history = history or []

    if not message or message.strip() == "":
        return "", history

    # user message
    history.append({
        "role": "user",
        "content": message
    })
    history.append({
        "role": "assistant",
        "content": "🤖 <span class='typing'><span></span><span></span><span></span></span>"
    })
    try:
        prompt = build_prompt(message)
        response = model.generate_content(prompt)

        if (
            response
            and response.candidates
            and response.candidates[0].content
            and response.candidates[0].content.parts
        ):
            reply = response.candidates[0].content.parts[0].text
        else:
            reply = "⚠️ AI did not return text content."

    except Exception as e:
        reply = f"❌ Gemini API error:\n{str(e)}"

    # assistant message
    history.append({
        "role": "assistant",
        "content": reply
    })

    return "", history





