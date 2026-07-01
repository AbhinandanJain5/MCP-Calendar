# check_account.py
from server import get_calendar_service

service = get_calendar_service()
cal = service.calendarList().get(calendarId="primary").execute()
print("Authenticated as:", cal.get("id"))