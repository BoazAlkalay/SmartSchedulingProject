from datetime import datetime, timedelta
from calendar_auth import get_personal_service
from calendar_reader import get_todays_events, get_free_slots
import frontmatter
from pathlib import Path
from config import TASKS, INBOX


def find_best_slot(duration_minutes: int) -> dict:
    """
    Find the best available slot for a task of given duration.
    Returns the suggested slot or None if no slot found.
    """
    events = get_todays_events()
    free_slots = get_free_slots(events)

    now = datetime.now()

    for slot in free_slots:
        if slot['duration_minutes'] >= duration_minutes:
            slot_start = datetime.strptime(
                f"{now.strftime('%Y-%m-%d')} {slot['start']}",
                "%Y-%m-%d %I:%M %p"
            )
            slot_end = datetime.strptime(
                f"{now.strftime('%Y-%m-%d')} {slot['end']}",
                "%Y-%m-%d %I:%M %p"
            )

            # Use current time as start if we're already inside this slot
            effective_start = max(slot_start, now)

            # Check enough time remains in slot
            remaining_minutes = (slot_end - effective_start).seconds // 60
            if remaining_minutes >= duration_minutes:
                end = effective_start + timedelta(minutes=duration_minutes)
                return {
                    'start': effective_start.strftime("%I:%M %p"),
                    'end': end.strftime("%I:%M %p"),
                    'start_iso': effective_start.isoformat(),
                    'end_iso': end.isoformat()
                }

    return None


def create_calendar_event(
    title: str,
    start_iso: str,
    end_iso: str,
    description: str = ""
) -> str:
    """
    Create an event on the personal Google Calendar.
    Returns the event ID.
    """
    service = get_personal_service()

    event = {
        'summary': title,
        'description': description,
        'start': {
            'dateTime': start_iso,
            'timeZone': 'America/New_York'
        },
        'end': {
            'dateTime': end_iso,
            'timeZone': 'America/New_York'
        }
    }

    created = service.events().insert(
        calendarId='primary',
        body=event
    ).execute()

    return created['id']


def update_task_with_event(task_title: str, event_id: str, scheduled_time: str, scheduled_date: str):
    """
    Update the task frontmatter with the calendar event ID, scheduled time, and scheduled date.
    Tries exact match first, then fuzzy.
    """
    all_files = list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md"))

    # Pass 1: exact match
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        if task_title.lower() == title.lower():
            post.metadata['calendar_event_id'] = event_id
            post.metadata['scheduled_time'] = scheduled_time
            post.metadata['scheduled_date'] = scheduled_date
            post.metadata['status'] = 'scheduled'
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(frontmatter.dumps(post))
            print(f"Updated task: {title}")
            return True

    # Pass 2: fuzzy match
    for filepath in all_files:
        post = frontmatter.load(filepath)
        title = post.metadata.get("title", "")
        if task_title.lower() in title.lower() or title.lower() in task_title.lower():
            post.metadata['calendar_event_id'] = event_id
            post.metadata['scheduled_time'] = scheduled_time
            post.metadata['scheduled_date'] = scheduled_date
            post.metadata['status'] = 'scheduled'
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(frontmatter.dumps(post))
            print(f"Updated task: {title}")
            return True

    return False


def delete_calendar_event(event_id: str) -> bool:
    """
    Delete a Google Calendar event by ID.
    Called when a task is deferred or retried.
    """
    try:
        service = get_personal_service()
        service.events().delete(
            calendarId='primary',
            eventId=event_id
        ).execute()
        print(f"Deleted calendar event: {event_id}")
        return True
    except Exception as e:
        print(f"Could not delete event {event_id}: {e}")
        return False


def schedule_task(
    task_title: str,
    duration_minutes: int,
    preferred_start: str = None,
    preferred_date: str = None       # NEW: "YYYY-MM-DD", defaults to today
) -> dict:
    """
    Main function — find a slot, create calendar event, update task file.
    preferred_start: time string e.g. "9:00 AM"
    preferred_date: date string e.g. "2026-04-08", defaults to today
    """
    print("DEBUG: schedule_task called with preferred_start/preferred_date")
    now = datetime.now()
    date_str = preferred_date if preferred_date else now.strftime("%Y-%m-%d")
 
    # Use preferred start time if provided
    if preferred_start:
        try:
            try:
                start = datetime.strptime(
                    f"{date_str} {preferred_start}",
                    "%Y-%m-%d %I:%M %p"
                )
            except ValueError:
                start = datetime.strptime(
                    f"{date_str} {preferred_start}",
                    "%Y-%m-%d %H:%M"
                )
            end = start + timedelta(minutes=duration_minutes)
            slot = {
                'start': start.strftime("%I:%M %p"),
                'end': end.strftime("%I:%M %p"),
                'start_iso': start.isoformat(),
                'end_iso': end.isoformat()
            }
        except ValueError:
            return {"status": "error", "message": f"Could not parse time: {preferred_start}"}
    else:
        # Auto-find best slot (today only)
        slot = find_best_slot(duration_minutes)
 
        if not slot:
            return {
                "status": "no_slot",
                "message": "No available slot found today for this task."
            }
 
    # Create the calendar event
    event_id = create_calendar_event(
        title=task_title,
        start_iso=slot['start_iso'],
        end_iso=slot['end_iso'],
        description="Scheduled by SmartScheduler"
    )
 
    # Update the task file
    update_task_with_event(task_title, event_id, slot['start'], date_str)
 
    return {
        "status": "scheduled",
        "title": task_title,
        "start": slot['start'],
        "end": slot['end'],
        "date": date_str,
        "event_id": event_id,
        "message": f"Scheduled '{task_title}' for {date_str} from {slot['start']} to {slot['end']}"
    }
 


if __name__ == "__main__":
    print("=== Test Schedule Task ===\n")

    result = schedule_task(
        task_title="Texas data quiz",
        duration_minutes=45
    )

    print(result)