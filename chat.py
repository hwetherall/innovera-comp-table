"""
Chat-with-results API endpoint.

Provides a streaming chat interface that lets users ask questions about
a specific V2 competitive intelligence run.  Uses a two-tier context
strategy (condensed summary + selective deep retrieval) and streams
tokens via Server-Sent Events.
"""

import json
import logging
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()

RESULTS_DIR = Path(__file__).parent.parent.parent / "data" / "results"

# In-memory cache so we don't re-read / re-build the condensed context
# on every message within the same server session.
_context_cache: dict[str, tuple[dict, str]] = {}


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[List[ChatMessage]] = None


def _load_run(run_id: str) -> tuple[dict, str]:
    """Return (data, condensed_context) for *run_id*, with caching."""
    if run_id in _context_cache:
        return _context_cache[run_id]

    json_path = RESULTS_DIR / f"{run_id}.json"
    if not json_path.exists():
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")

    with open(json_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    from utils.chat_context import build_condensed_context
    condensed = build_condensed_context(data)

    _context_cache[run_id] = (data, condensed)
    return data, condensed


SYSTEM_TEMPLATE = """\
You are an expert competitive-intelligence analyst assistant. The user is \
viewing an interactive report and wants to explore the findings through \
conversation.

Below is a condensed summary of the full report data. Use it to answer \
the user's questions accurately, citing specific companies, parameters, \
rankings, and data points from the report. When you are unsure or the \
data does not cover the question, say so honestly.

Formatting rules:
- Use markdown for structure (headings, bold, lists, tables).
- Keep answers focused and concise unless the user asks for depth.
- When comparing companies, use a markdown table when helpful.

---
{condensed_context}
{extra_context}"""


@router.post("/{run_id}")
async def chat(run_id: str, req: ChatRequest):
    """Stream a chat response for the given run."""
    from config import settings
    from agents.llm_client import LLMClient, LLMError
    from utils.chat_context import get_relevant_sections

    data, condensed = _load_run(run_id)

    history_dicts = [m.model_dump() for m in (req.history or [])]

    extra = get_relevant_sections(data, req.message, history=history_dicts)

    system_content = SYSTEM_TEMPLATE.format(
        condensed_context=condensed,
        extra_context=extra,
    )

    messages = [{"role": "system", "content": system_content}]
    for m in history_dicts:
        messages.append({"role": m["role"], "content": m["content"]})
    messages.append({"role": "user", "content": req.message})

    client = LLMClient()

    async def event_generator():
        try:
            async for token in client.complete_stream(
                messages,
                temperature=0.4,
                max_tokens=4096,
                model_override=settings.CHAT_MODEL,
            ):
                yield f"data: {json.dumps({'token': token})}\n\n"
            yield "data: [DONE]\n\n"
        except LLMError as exc:
            logger.error("Chat stream error: %s", exc.message)
            yield f"data: {json.dumps({'error': exc.message})}\n\n"
        except Exception as exc:
            logger.exception("Unexpected chat stream error")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
