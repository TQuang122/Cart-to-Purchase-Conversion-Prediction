from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import os

from api.routers.chat import router as chat_router
from api.routers.dataset import router as dataset_router
from api.routers.model import router as model_router
from api.routers.predict import router as predict_router

load_dotenv()


def _parse_csv_env(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name, "")
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return values or default


app = FastAPI(title="Cart to Purchase API", version="0.1.0")

default_cors_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://cart-to-purchase-conversion-predict.vercel.app",
]

cors_origins = _parse_csv_env("CORS_ORIGINS", default_cors_origins)
cors_origin_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https?://(localhost|127\.0\.0\.1|.*\.vercel\.app|.*\.trycloudflare\.com)(:\d+)?$",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(predict_router)
app.include_router(chat_router)
app.include_router(dataset_router)
app.include_router(model_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
