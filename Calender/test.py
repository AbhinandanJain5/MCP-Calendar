# test.py
from server import list_events, create_event, check_conflicts

print(list_events(days_ahead=7))
print(check_conflicts("2026-07-05T17:00:00", "2026-07-05T18:00:00"))