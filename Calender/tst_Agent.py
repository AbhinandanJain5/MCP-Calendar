"""
Offline sanity check for the agent loop's orchestration logic (message
building, tool-call parsing, loop termination) WITHOUT hitting the real
Groq API or a real Google Calendar. Run this to confirm the plumbing works
before you wire up real credentials.
"""
import os
import json
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("GROQ_API_KEY", "dummy-key-for-offline-test")

import agent  # noqa: E402  (import after env var is set)


def fake_tool_call(name, args):
    return SimpleNamespace(
        id=f"call_{name}",
        function=SimpleNamespace(name=name, arguments=json.dumps(args)),
    )


def fake_response(content=None, tool_calls=None):
    msg = SimpleNamespace(content=content, tool_calls=tool_calls)
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


call_count = {"n": 0}


def fake_create(**kwargs):
    """Simulate: turn 1 -> model wants to call list_events.
    Turn 2 -> model has seen the tool result and gives a final answer."""
    call_count["n"] += 1
    if call_count["n"] == 1:
        return fake_response(
            content=None,
            tool_calls=[fake_tool_call("list_events", {"days_ahead": 3})],
        )
    return fake_response(content="You have 2 events in the next 3 days.")


def fake_list_events(days_ahead=7):
    return f"- Fake Meeting at 2026-07-02T10:00:00\n- Fake Call at 2026-07-03T15:00:00 (days_ahead={days_ahead})"


with patch.object(agent.client.chat.completions, "create", side_effect=fake_create), \
     patch.dict(agent.AVAILABLE_FUNCTIONS, {"list_events": fake_list_events}):

    reply, history = agent.run_agent("What's on my calendar in the next 3 days?")

    assert call_count["n"] == 2, f"expected 2 model calls, got {call_count['n']}"
    assert "2 events" in reply, f"unexpected final reply: {reply}"
    tool_msgs = [m for m in history if isinstance(m, dict) and m.get("role") == "tool"]
    assert len(tool_msgs) == 1, "expected exactly 1 tool result message"
    assert "Fake Meeting" in tool_msgs[0]["content"]

    print("PASS: agent loop calls the tool, feeds the result back, and returns a final answer.")
    print(f"Final reply: {reply}")