from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import (
    annotations,
    audio,
    enrich,
    profile,
    review,
    settings,
    stats,
    study,
    tags,
    texts,
    vocab,
)

app = FastAPI(title="tadabbur")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(texts.router, prefix="/api")
app.include_router(vocab.router, prefix="/api")
app.include_router(review.router, prefix="/api")
app.include_router(stats.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(enrich.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(study.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(annotations.router, prefix="/api")
app.include_router(audio.router, prefix="/api/audio")


@app.get("/api/health")
def health():
    return {"ok": True}
