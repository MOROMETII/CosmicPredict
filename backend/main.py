import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import router

app = FastAPI(title="COSMIC PREDICT API", version="0.1.0")

# Allow any origin by default so image fetches and WebGL texture loads work no
# matter which host/port the frontend is served from. Restrict with the
# comma-separated CORS_ORIGINS env var if needed.
_origins = [origin.strip() for origin in os.environ.get("CORS_ORIGINS", "*").split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins or ["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
