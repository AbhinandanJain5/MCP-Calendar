"""
JARVIS Web API
--------------
Thin FastAPI wrapper around your existing agent.py (Groq agent loop) and
server.py (Google Calendar tools), so the JARVIS React UI can talk to it
over HTTP instead of the command line.

Run:
    pip install fastapi uvicorn
    uvicorn api:app --reload --port 8000

Then open the JARVIS UI (jarvis-ui.jsx) — it's already pointed at
http://localhost:8000.

Endpoints:
    GET  /health              -> {"status": "ok"}           (used to detect live mode)
    GET  /api/events          -> list upcoming events
    POST /api/chat            -> {"message": str, "history": [...]}
                                  -> {"reply": str, "history": [...]}
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, List, Optional

from agent import run_agent
from server import list_events

app = FastAPI(title="JARVIS Calendar API")

# The React UI runs in the browser (e.g. from claude.ai's artifact preview,
# or a static file server on your machine) so we open CORS up for local dev.
# Tighten this to your actual frontend origin before deploying anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[Any]] = None


class ChatResponse(BaseModel):
    reply: str
    history: List[Any]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/events")
def get_events(days: int = 7):
    raw = list_events(days_ahead=days)
    return {"raw": raw}


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    reply, updated_history = run_agent(req.message, req.history)
    # updated_history holds Groq message dicts (with tool_calls/tool results);
    # safe to round-trip back to the client as-is for the next turn.
    return ChatResponse(reply=reply or "", history=updated_history)