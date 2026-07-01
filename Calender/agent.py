"""
Calendar Agent (Groq-powered)
------------------------------
A hand-written agent loop: no LangChain, no framework magic. This is the part
that actually demonstrates "I understand agent orchestration" for a resume/interview.

Flow:
  1. User sends a message
  2. We send it + tool schemas to Groq
  3. If the model wants to call a tool, we run the matching Python function
  4. We feed the tool's result back to the model
  5. Repeat until the model gives a final text answer (or we hit max_turns)

Setup:
  1. pip install -r requirements.txt
  2. Get a free API key at https://console.groq.com/keys
  3. Put GROQ_API_KEY=your-key-here in a .env file (or export it directly)
  4. Make sure server.py's Google auth is already working (run it once first)
  5. python agent.py
"""

import os
import json
from datetime import datetime

from groq import Groq, BadRequestError
from dotenv import load_dotenv

from server import list_events, check_conflicts, create_event, delete_event, parse_datetime

load_dotenv()
api_key = os.environ.get("GROQ_API_KEY")

# ---- Setup ----
client = Groq(api_key=api_key)

# llama-3.3-70b-versatile is noticeably more reliable at multi-step tool
# chains than the 8b version -- less likely to lose track of a value (like a
# parsed datetime) between one tool call and the next. Slower, still free on
# Groq. Swap to "llama-3.1-8b-instant" if you want to compare speed/reliability
# tradeoffs for your resume talking points.
MODEL = "llama-3.3-70b-versatile"

# Map the name the model sees -> the actual Python function to run
AVAILABLE_FUNCTIONS = {
    "parse_datetime": parse_datetime,
    "list_events": list_events,
    "check_conflicts": check_conflicts,
    "create_event": create_event,
    "delete_event": delete_event,
}

# JSON schema describing each tool. This is what the model actually "sees" to
# decide which function to call and with what arguments.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "parse_datetime",
            "description": (
                "Convert a natural-language date/time phrase into an exact ISO "
                "datetime. ALWAYS call this for any date/time the user mentions "
                "-- never compute or guess an ISO datetime yourself."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Just the date/time phrase, e.g. 'today 3:30pm', 'tomorrow at 5pm', 'friday 10am'. Do not include the event title.",
                    }
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_events",
            "description": "List upcoming calendar events for the next N days.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days_ahead": {
                        "type": "integer",
                        "description": "How many days ahead to look. Default 7.",
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_conflicts",
            "description": "Check whether a proposed time slot conflicts with existing events.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_time": {
                        "type": "string",
                        "description": "Exact ISO local time from parse_datetime, e.g. 2026-07-05T17:00:00",
                    },
                    "end_time": {
                        "type": "string",
                        "description": "Exact ISO local time from parse_datetime, e.g. 2026-07-05T18:00:00",
                    },
                },
                "required": ["start_time", "end_time"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_event",
            "description": "Create a new calendar event. Always check_conflicts first unless the user says to skip that. If the user didn't give a duration, omit end_time -- it defaults to 1 hour.",
            "parameters": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string", "description": "Title of the event"},
                    "start_time": {"type": "string", "description": "Exact ISO local time from parse_datetime"},
                    "end_time": {"type": "string", "description": "Exact ISO local time from parse_datetime. Omit if unknown -- defaults to start_time + 1 hour."},
                    "description": {"type": "string", "description": "Optional extra details"},
                },
                "required": ["summary", "start_time"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "delete_event",
            "description": "Delete a calendar event by its ID. Only call this after the user has explicitly confirmed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "event_id": {
                        "type": "string",
                        "description": "The event's ID, obtained from list_events",
                    }
                },
                "required": ["event_id"],
            },
        },
    },
]


def system_prompt() -> str:
    today = datetime.now().strftime("%A, %Y-%m-%d %H:%M")
    return f"""You are a helpful calendar assistant. Today is {today}.

You have tools to view, create, check conflicts for, and delete calendar events.
Rules you must follow:
- For ANY date or time the user mentions, call parse_datetime with just the
  date/time phrase (e.g. "today 3:30pm") to get the exact ISO datetime.
  NEVER compute or guess an ISO datetime yourself -- you are bad at this,
  always delegate it to the tool. Then copy that tool's returned value
  EXACTLY, character for character, into start_time/end_time. Do not modify,
  round, or recompute it in any way.
- Always call check_conflicts before create_event, unless the user explicitly
  says to skip that check.
- Never call delete_event unless the user has clearly confirmed they want
  that specific event deleted.
- When you don't have an event's ID for a delete request, call list_events
  first to find it.
- If the user doesn't specify a duration, omit end_time in create_event --
  it will default to 1 hour automatically.
- Keep replies short and conversational, like a helpful assistant texting back."""


def _call_model_with_retry(messages, retries: int = 2):
    """Call the Groq API, retrying with a corrective nudge if the model
    emits a malformed tool call. This is a known flakiness with open-weight
    models, especially smaller/faster ones like llama-3.1-8b-instant."""
    for attempt in range(retries + 1):
        try:
            return client.chat.completions.create(
                model=MODEL,
                messages=messages,
                tools=TOOLS,
                tool_choice="auto",
                temperature=0.2,  # more deterministic tool-call formatting
            )
        except BadRequestError as e:
            if "tool_use_failed" not in str(e):
                raise  # a different kind of error -- don't swallow it
            if attempt == retries:
                print(f"[Gave up after {retries} retries: malformed tool call]")
                return None
            print(f"[Retry {attempt + 1}/{retries}] Malformed tool call, nudging model...")
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "Your last response was not a valid tool call. You must use "
                        "the function-calling interface exactly as provided -- do not "
                        "write function calls as plain text like <function=...>. "
                        "Either call a tool correctly, or answer in plain text."
                    ),
                }
            )
    return None


def run_agent(user_message: str, history=None, max_turns: int = 6):
    """
    Runs one conversation turn with iterative tool calling.
    Returns:
        (assistant_reply, updated_history)
    """
    if history is None:
        messages = [{"role": "system", "content": system_prompt()}]
    else:
        messages = history

    messages.append({"role": "user", "content": user_message})

    # Datetimes actually returned by parse_datetime this turn. check_conflicts
    # and create_event are only allowed to use values from this set -- this
    # catches the model silently substituting its own (wrong) guess instead
    # of the tool's real, deterministic output.
    trusted_datetimes = set()

    for _ in range(max_turns):
        response = _call_model_with_retry(messages)

        if response is None:
            return (
                "I had trouble calling a tool correctly after a few tries -- "
                "try rephrasing your request."
            ), messages

        assistant = response.choices[0].message

        assistant_message = {
            "role": "assistant",
            "content": assistant.content or "",
        }

        if hasattr(assistant, 'tool_calls') and assistant.tool_calls:
            assistant_message["tool_calls"] = []
            for tc in assistant.tool_calls:
                assistant_message["tool_calls"].append(
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                )

        messages.append(assistant_message)

        if not assistant.tool_calls:
            return assistant.content, messages

        for tc in assistant.tool_calls:
            fn_name = tc.function.name
            fn_args = json.loads(tc.function.arguments or "{}")

            print(f"\n[Tool] {fn_name}")
            print(fn_args)

            fn = AVAILABLE_FUNCTIONS.get(fn_name)

            # Guardrail: check_conflicts/create_event must use a datetime that
            # was actually returned by parse_datetime earlier in this turn.
            bad_field = None
            if fn_name in ("check_conflicts", "create_event"):
                for field in ("start_time", "end_time"):
                    value = fn_args.get(field)
                    if value and value not in trusted_datetimes:
                        bad_field = field
                        break

            if bad_field:
                result = (
                    f"Error: {bad_field}='{fn_args[bad_field]}' does not match "
                    f"any value returned by parse_datetime in this conversation "
                    f"turn. Call parse_datetime again with the user's exact "
                    f"phrase, then use its returned value exactly -- do not "
                    f"guess or recompute the date/time yourself."
                )
                print(f"[Guardrail blocked] {fn_name}.{bad_field}={fn_args.get(bad_field)!r} not verified")
            elif fn is None:
                result = f"Unknown tool: {fn_name}"
            else:
                try:
                    result = fn(**fn_args)
                except Exception as e:
                    result = f"Error: {e}"

            if fn_name == "parse_datetime" and isinstance(result, str) and "T" in result:
                trusted_datetimes.add(result)

            print("[Result]")
            print(result)

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": str(result),
                }
            )

    return "Maximum tool iterations reached.", messages


if __name__ == "__main__":
    print("Calendar agent ready (type 'quit' to exit)\n")
    convo_history = None
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in {"quit", "exit"}:
            break
        reply, convo_history = run_agent(user_input, convo_history)
        print(f"Agent: {reply}\n")