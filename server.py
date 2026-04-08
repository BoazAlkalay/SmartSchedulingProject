from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import uvicorn

from what_now import what_now
from task_entry import add_task
from reschedule import panic_button, stopping_now, retry_later
from checkin import create_checkin

app = FastAPI(title="Smart Scheduler")

# --- Request Models ---

class WhatNowRequest(BaseModel):
    energy: Optional[str] = None
    slots_remaining: Optional[str] = None

class AddTaskRequest(BaseModel):
    text: str

class CheckinRequest(BaseModel):
    doing: str
    energy: Optional[str] = "unknown"
    slots_remaining: Optional[str] = "unknown"
    mood: Optional[str] = ""
    notes: Optional[str] = ""

class PanicRequest(BaseModel):
    reason: Optional[str] = ""

class StoppingNowRequest(BaseModel):
    task_title: str
    progress: str
    remaining: str
    continuation_note: Optional[str] = ""
    energy: Optional[str] = "unknown"

class RetryRequest(BaseModel):
    task_title: str
    retry_time: str
    retry_note: Optional[str] = ""
    energy: Optional[str] = "unknown"

class NoteRequest(BaseModel):
    note: str
    type: Optional[str] = "observation"

class ScheduleTaskRequest(BaseModel):
    task_title: str
    duration_minutes: int
    preferred_start: Optional[str] = None
    preferred_date: Optional[str] = None  

# --- Endpoints ---

@app.get("/health")
def health_check():
    """Quick check that the server is running."""
    return {"status": "ok"}

@app.post("/what-now")
def get_what_now(request: WhatNowRequest):
    """What should I do right now?"""
    try:
        response = what_now(
            current_energy=request.energy,
            slots_remaining=request.slots_remaining
        )
        return {"response": response}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/add-task")
def add_task_endpoint(request: AddTaskRequest):
    """Add a new task from natural language."""
    try:
        filepath = add_task(request.text)
        if filepath is None:
            raise HTTPException(status_code=400, detail="Failed to parse task.")
        return {"status": "created", "file": str(filepath)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/checkin")
def checkin_endpoint(request: CheckinRequest):
    """Log what you're currently doing."""
    try:
        filepath = create_checkin(
            doing=request.doing,
            energy=request.energy,
            slots_remaining=request.slots_remaining,
            mood=request.mood,
            notes=request.notes
        )
        return {"status": "logged", "file": str(filepath)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/panic")
def panic_endpoint(request: PanicRequest):
    """Panic button — reset everything without judgment."""
    try:
        message = panic_button(request.reason)
        return {"status": "reset", "message": message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/stopping-now")
def stopping_now_endpoint(request: StoppingNowRequest):
    """Stopping on a task but need more time."""
    try:
        message = stopping_now(
            task_title=request.task_title,
            progress=request.progress,
            remaining=request.remaining,
            continuation_note=request.continuation_note,
            energy=request.energy
        )
        return {"status": "saved", "message": message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/retry")
def retry_endpoint(request: RetryRequest):
    """Didn't start — set a retry time."""
    try:
        message = retry_later(
            task_title=request.task_title,
            retry_time=request.retry_time,
            retry_note=request.retry_note,
            energy=request.energy
        )
        return {"status": "retry set", "message": message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/note")
def note_endpoint(request: NoteRequest):
    """Log a note to observations or complaints."""
    try:
        from config import OBSERVATIONS, COMPLAINTS
        from datetime import datetime

        today = datetime.now().strftime("%Y-%m-%d %H:%M")
        entry = f"\n## {today}\n{request.note}\n"

        if request.type == "complaint":
            filepath = COMPLAINTS
        else:
            filepath = OBSERVATIONS

        with open(filepath, 'a', encoding='utf-8') as f:
            f.write(entry)

        return {"status": "logged", "type": request.type}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/tasks/current")
def get_current_tasks():
    """Return current unfinished tasks as a simple list."""
    try:
        from config import TASKS, INBOX
        import frontmatter

        tasks = []

        for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
            post = frontmatter.load(filepath)
            status = post.metadata.get("status", "")
            title = post.metadata.get("title", "")

            # Skip files without proper task structure
            if not title or not status:
                continue

            if status not in ["done"]:
                tasks.append({
                    "title": title,
                    "status": status,
                    "energy": post.metadata.get("energy_required", "unknown"),
                    "file": filepath.name
                })

        return {
            "tasks": tasks,
            "titles": [t["title"] for t in tasks]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/tasks/titles")
def get_task_titles():
    """Return task titles as a plain list for Shortcuts."""
    try:
        from config import TASKS, INBOX
        import frontmatter
        
        titles = []
        for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
            post = frontmatter.load(filepath)
            title = post.metadata.get("title", "")
            status = post.metadata.get("status", "")
            if title and status and status != "done":
                titles.append(title)
        
        return titles
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

 
 
@app.post("/schedule-task")
def schedule_task_endpoint(request: ScheduleTaskRequest):
    """Find a slot and schedule a task on Google Calendar."""
    try:
        from calendar_writer import schedule_task
        result = schedule_task(
            task_title=request.task_title,
            duration_minutes=request.duration_minutes,
            preferred_start=request.preferred_start,
            preferred_date=request.preferred_date   # NEW
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class FindSlotRequest(BaseModel):
    duration_minutes: int

@app.post("/find-slot")
def find_slot_endpoint(request: FindSlotRequest):
    """Find the best available slot for a given duration."""
    try:
        from calendar_writer import find_best_slot
        slot = find_best_slot(request.duration_minutes)
        if not slot:
            return {"status": "no_slot", "message": "No available slot found today"}
        return {"status": "found", "start": slot['start'], "end": slot['end'], 
                "start_iso": slot['start_iso'], "end_iso": slot['end_iso']}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
class CompleteTaskRequest(BaseModel):
    task_title: str
    actual_duration: Optional[str] = ""
    energy: Optional[str] = "unknown"
    notes: Optional[str] = ""

@app.post("/complete-task")
def complete_task_endpoint(request: CompleteTaskRequest):
    """Mark a task as complete."""
    try:
        from reschedule import complete_task
        message = complete_task(
            task_title=request.task_title,
            actual_duration=request.actual_duration,
            energy=request.energy,
            notes=request.notes
        )
        return {"status": "done", "message": message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/whats-coming")
def whats_coming(scope: str = "today_remaining"):
    """
    Return a merged, sorted view of calendar events and scheduled tasks.
 
    scope options:
      - today_remaining  → from now until end of today
      - full_today       → full day from midnight (includes past events/tasks)
      - two_days         → rest of today + all of tomorrow
    """
    try:
        from calendar_reader import get_all_events, parse_event_time
        from config import TASKS, INBOX
        import frontmatter
        from datetime import datetime, timedelta
 
        now = datetime.now()
        today_str = now.strftime("%Y-%m-%d")
        tomorrow_str = (now + timedelta(days=1)).strftime("%Y-%m-%d")
 
        # --- Define time window ---
        if scope == "full_today":
            window_start = datetime.fromisoformat(f"{today_str}T00:00:00")
            window_end = datetime.fromisoformat(f"{today_str}T23:59:59")
            days_ahead = 1
        elif scope == "two_days":
            window_start = now
            window_end = datetime.fromisoformat(f"{tomorrow_str}T23:59:59")
            days_ahead = 2
        else:  # today_remaining (default)
            window_start = now
            window_end = datetime.fromisoformat(f"{today_str}T23:59:59")
            days_ahead = 1
 
        # --- Fetch calendar events ---
        raw_events = get_all_events(days_ahead=days_ahead)
        items = []
 
        for e in raw_events:
            if e['all_day']:
                continue
 
            try:
                start_dt = parse_event_time(e['start']).replace(tzinfo=None)
                end_dt = parse_event_time(e['end']).replace(tzinfo=None)
            except Exception:
                continue
 
            if start_dt < window_start or start_dt > window_end:
                continue
 
            items.append({
                "type": "calendar",
                "title": e['title'],
                "calendar": e['calendar'],
                "start_dt": start_dt,
                "start": start_dt.strftime("%I:%M %p"),
                "end": end_dt.strftime("%I:%M %p"),
                "date": start_dt.strftime("%Y-%m-%d"),
                "status": None,
                "energy": None,
                "overdue": False,
            })
 
        # --- Fetch scheduled tasks ---
        for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
            post = frontmatter.load(filepath)
            title = post.metadata.get("title", "")
            status = post.metadata.get("status", "")
            scheduled_time = post.metadata.get("scheduled_time")
            scheduled_date = post.metadata.get("scheduled_date")
 
            if not title or status != "scheduled" or not scheduled_time:
                continue
 
            # Use scheduled_date if available, otherwise fall back to today
            date_str = scheduled_date if scheduled_date else today_str
 
            try:
                try:
                    task_dt = datetime.strptime(
                        f"{date_str} {scheduled_time}", "%Y-%m-%d %I:%M %p"
                    )
                except ValueError:
                    task_dt = datetime.strptime(
                        f"{date_str} {scheduled_time}", "%Y-%m-%d %H:%M"
                    )
            except Exception:
                continue
 
            # Overdue = scheduled in the past and not done
            overdue = task_dt < now
 
            # For today_remaining: include overdue tasks so they aren't invisible
            # For other scopes: apply normal window filter
            if scope == "today_remaining":
                if task_dt > window_end:
                    continue
                # overdue tasks always included — they need attention
            else:
                if task_dt < window_start or task_dt > window_end:
                    continue
 
            duration = post.metadata.get("duration_estimated", "")
            energy = post.metadata.get("energy_required", "unknown")
 
            items.append({
                "type": "task",
                "title": title,
                "calendar": None,
                "start_dt": task_dt,
                "start": task_dt.strftime("%I:%M %p"),
                "end": None,
                "date": date_str,
                "status": status,
                "energy": energy,
                "duration": duration,
                "overdue": overdue,
            })
 
        # --- Sort: overdue tasks first, then chronological ---
        items.sort(key=lambda x: (not x["overdue"], x["start_dt"]))
 
        # --- Strip start_dt (not JSON serializable) ---
        for item in items:
            del item["start_dt"]
 
        # --- Build plain text summary ---
        if not items:
            summary = "Nothing scheduled for this window. Free time."
        else:
            lines = []
            current_date = None
            showed_overdue_header = False
 
            for item in items:
                # Overdue section header
                if item["overdue"] and not showed_overdue_header:
                    lines.append("⚠️ Overdue")
                    showed_overdue_header = True
                elif not item["overdue"] and showed_overdue_header and current_date is None:
                    lines.append("")  # spacer after overdue section
 
                # Date header for two_days scope
                if scope == "two_days" and not item["overdue"] and item["date"] != current_date:
                    current_date = item["date"]
                    label = "Today" if current_date == today_str else "Tomorrow"
                    lines.append(f"\n── {label} ──")
 
                if item["type"] == "calendar":
                    lines.append(
                        f"📅 {item['start']} {item['title']} ({item['calendar']})"
                    )
                else:
                    duration_str = f" · {item['duration']}" if item.get("duration") else ""
                    energy_str = f" [{item['energy']}]" if item.get("energy") else ""
                    overdue_flag = " ⚠️" if item["overdue"] else ""
                    lines.append(
                        f"✅ {item['start']} {item['title']}{duration_str}{energy_str}{overdue_flag}"
                    )
 
            summary = "\n".join(lines).strip()
 
        return {
            "scope": scope,
            "generated_at": now.strftime("%Y-%m-%d %H:%M"),
            "count": len(items),
            "summary": summary,
            "items": items
        }
 
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
 

class ExtendTaskRequest(BaseModel):
    task_title: str
    additional_minutes: int
    energy: Optional[str] = "unknown"
 
@app.post("/extend-task")
def extend_task_endpoint(request: ExtendTaskRequest):
    """Extend a task that's currently in progress."""
    try:
        from reschedule import extend_task
        message = extend_task(
            task_title=request.task_title,
            additional_minutes=request.additional_minutes,
            energy=request.energy
        )
        return {"status": "extended", "message": message}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
