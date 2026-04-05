from datetime import datetime, timedelta, timezone
from calendar_auth import get_personal_service, get_school_service
import re


def parse_event_time(time_str: str) -> datetime:
    """
    Parse Google Calendar time string to local datetime.
    Handles both UTC (Z) and offset formats.
    """
    # Remove Z and replace with UTC offset
    time_str = time_str.replace('Z', '+00:00')
    dt = datetime.fromisoformat(time_str)
    
    # Convert to local time
    local_dt = dt.astimezone()
    return local_dt


def get_events(service, days_ahead: int = 7) -> list:
    """
    fetch calendar events for the next x days
    returns a list of event dictionaries
    """
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days_ahead)

    event_results = service.events().list(
        calendarId='primary',
        timeMin=now.isoformat(),
        timeMax=end.isoformat(),
        singleEvents=True,
        orderBy='startTime'
    ).execute()

    events = []
    for event in event_results.get('items',[]):
        start = event['start'].get('dateTime', event['start'].get('date'))
        end_time = event['end'].get('dateTime', event['end'].get('date'))

        events.append({
            'title': event.get('summary', 'Untitled'),
            'start': start,
            'end': end_time,
            'calendar': 'unknown',
            'all_day': 'dateTime' not in event['start'],
            'id': event.get('id')
        })
    
    return events

def get_all_events(days_ahead: int = 7) -> list:
    """
    Fetch events from both personal and school calendars.
    Marks which calendar each event came from.
    """
    personal = get_personal_service()
    school = get_school_service()
    
    personal_events = get_events(personal, days_ahead)
    for e in personal_events:
        e['calendar'] = 'personal'
    
    school_events = get_events(school, days_ahead)
    for e in school_events:
        e['calendar'] = 'school'
    
    # Combine and sort by start time
    all_events = personal_events + school_events
    all_events.sort(key=lambda x: x['start'])
    
    return all_events

def get_todays_events() -> list:
    """ get today's events from both calendars """
    all_events = get_all_events(days_ahead=1)

    today = datetime.now().strftime("%Y-%m-%d")
    todays = [e for e in all_events if e['start'].startswith(today)]

    return todays

def get_free_slots(events: list, 
                   start_hour: int = 8, 
                   end_hour: int = 22,
                   min_slot_minutes: int = 15) -> list:
    """
    Given a list of events, find free time slots today.
    Returns slots as list of (start, end) tuples.
    """
    today = datetime.now().strftime("%Y-%m-%d")
    
    day_start = datetime.fromisoformat(f"{today}T{start_hour:02d}:00:00")
    day_end = datetime.fromisoformat(f"{today}T{end_hour:02d}:00:00")
    
    # filter to timed events today only
    timed_events = []
    for e in events:
        if e['all_day']:
            continue
        if not e['start'].startswith(today):
            continue

        start = parse_event_time(e['start']).replace(tzinfo=None)
        end = parse_event_time(e['end']).replace(tzinfo=None)
        timed_events.append((start, end))

    timed_events.sort(key=lambda x: x[0])

    # find gaps
    free_slots = []
    current = day_start

    for event_start, event_end in timed_events:
        if current < event_start:
            gap_minutes = (event_start - current).seconds // 60
            if gap_minutes >= min_slot_minutes:
                free_slots.append({
                    'start': current.strftime("%I:%M %p"),
                    'end': event_start.strftime("%I:%M %p"),
                    'duration_minutes': gap_minutes
                })
        current = max(current, event_end)

    # check remaining time after last event
    if current < day_end:
        gap_minutes = (day_end - current).seconds // 60
        if gap_minutes >= min_slot_minutes:
            free_slots.append({
                'start': current.strftime("%I:%M %p"),
                'end': day_end.strftime("%I:%M %p"),
                'duration_minutes': gap_minutes
            })
    
    return free_slots


if __name__ == "__main__":
    print("=== Today's Events ===\n")
    events = get_todays_events()
    
    if not events:
        print("No events today.")
    else:
        for e in events:
            print(f"[{e['calendar']}] {e['title']}")
            print(f"  {e['start']} → {e['end']}")
    
    print("\n=== Free Slots Today ===\n")
    free = get_free_slots(events)
    
    if not free:
        print("No free slots found.")
    else:
        for slot in free:
            print(f"{slot['start']} → {slot['end']} ({slot['duration_minutes']} min)")