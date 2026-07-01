"""
Calendar MCP Server
--------------------
Exposes Google Calendar as a set of tools an AI agent can call:
  - list_events        : see what's coming up
  - check_conflicts    : is a time slot free?
  - create_event       : book something
  - delete_event       : cancel something
  - parse_datetime      : convert natural language ("today 3:30pm") into an
                          exact ISO datetime -- deterministic, not LLM guesswork

Run this directly to test locally, or point an MCP client (like Claude
Desktop) at it to let an agent use it in conversation.
"""

import os
import pickle
from datetime import datetime, timedelta

import dateparser
from google.auth.transport.requests import Request
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from mcp.server.fastmcp import FastMCP

# ---- Config ----
SCOPES = ["https://www.googleapis.com/auth/calendar"]
TIMEZONE = "Asia/Kolkata"  
CREDENTIALS_FILE = os.path.join(os.path.dirname(__file__), "credentials.json")
TOKEN_FILE = os.path.join(os.path.dirname(__file__), "token.pickle")

mcp = FastMCP("calendar-agent")


def get_calendar_service():
    """Authenticate with Google and return a Calendar API client.
    First run opens a browser for you to log in; after that it reuses
    a saved token so you don't have to log in every time."""
    creds = None
    if os.path.exists(TOKEN_FILE):
        with open(TOKEN_FILE, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                raise FileNotFoundError(
                    "credentials.json not found. Download it from Google Cloud "
                    "Console (OAuth client ID, Desktop app) and place it in this folder."
                )
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, "wb") as f:
            pickle.dump(creds, f)

    # cache_discovery=False silences the harmless
    # "file_cache is only supported with oauth2client<4.0.0" warning
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


@mcp.tool()
def parse_datetime(text: str) -> str:
    """Convert a natural-language date/time phrase into an exact ISO datetime
    (YYYY-MM-DDTHH:MM:SS). Examples: 'today 3:30pm', 'tomorrow at 5pm',
    'friday 10am'. ALWAYS call this for any date/time the user mentions --
    never compute or guess an ISO datetime yourself. Pass ONLY the date/time
    phrase, not the whole sentence (e.g. 'today 3:30pm', not '3:30 pm lunch')."""
    settings = {
        "TIMEZONE": TIMEZONE,
        "RETURN_AS_TIMEZONE_AWARE": False,
        "PREFER_DATES_FROM": "future",
    }
    dt = dateparser.parse(text, settings=settings)
    if dt is None:
        # dateparser sometimes chokes on "next"/"this" prefixes -- retry without them
        stripped = text.lower().replace("next ", "").replace("this ", "")
        dt = dateparser.parse(stripped, settings=settings)
    if dt is None:
        return (
            f"Could not parse '{text}' into a date/time. "
            "Ask the user to clarify with a specific day and time."
        )
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


@mcp.tool()
def list_events(days_ahead: int = 7) -> str:
    """List upcoming calendar events for the next N days (default 7)."""
    service = get_calendar_service()
    now = datetime.utcnow().isoformat() + "Z"
    end = (datetime.utcnow() + timedelta(days=days_ahead)).isoformat() + "Z"

    result = service.events().list(
        calendarId="primary",
        timeMin=now,
        timeMax=end,
        singleEvents=True,
        orderBy="startTime",
    ).execute()

    events = result.get("items", [])
    if not events:
        return f"No events in the next {days_ahead} day(s)."

    lines = []
    for e in events:
        start = e["start"].get("dateTime", e["start"].get("date"))
        lines.append(f"- {e.get('summary', '(no title)')} at {start}  [id: {e['id']}]")
    return "\n".join(lines)


@mcp.tool()
def check_conflicts(start_time: str, end_time: str) -> str:
    """Check whether a proposed time slot conflicts with existing events.
    Times must be exact ISO local time (get them from parse_datetime first),
    e.g. '2026-07-05T17:00:00'."""
    service = get_calendar_service()

    result = service.events().list(
        calendarId="primary",
        timeMin=f"{start_time}+05:30",
        timeMax=f"{end_time}+05:30",
        singleEvents=True,
    ).execute()

    events = result.get("items", [])
    if not events:
        return "No conflicts \u2014 this time slot is free."

    names = [e.get("summary", "(no title)") for e in events]
    return "Conflict found with: " + ", ".join(names)


@mcp.tool()
def create_event(summary: str, start_time: str, end_time: str = "", description: str = "") -> str:
    """Create a calendar event. start_time must be exact ISO local time
    (get it from parse_datetime first), e.g. '2026-07-05T17:00:00'.
    end_time is optional -- if omitted, defaults to 1 hour after start_time."""
    service = get_calendar_service()

    if not end_time:
        start_dt = datetime.fromisoformat(start_time)
        end_time = (start_dt + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S")

    event = {
        "summary": summary,
        "description": description,
        "start": {"dateTime": start_time, "timeZone": TIMEZONE},
        "end": {"dateTime": end_time, "timeZone": TIMEZONE},
    }
    created = service.events().insert(calendarId="primary", body=event).execute()
    return f"Event created: {created.get('summary')} at {start_time} \u2192 {created.get('htmlLink')}"


@mcp.tool()
def delete_event(event_id: str) -> str:
    """Delete a calendar event by its ID (get the ID from list_events first)."""
    service = get_calendar_service()
    service.events().delete(calendarId="primary", eventId=event_id).execute()
    return f"Event {event_id} deleted."


if __name__ == "__main__":
    mcp.run()