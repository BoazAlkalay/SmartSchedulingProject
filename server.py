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

class ScheduleTaskRequest(BaseModel):
    task_title: str
    duration_minutes: int
    preferred_slot: Optional[str] = None

@app.post("/schedule-task")
def schedule_task_endpoint(request: ScheduleTaskRequest):
    """Find a slot and schedule a task on Google Calendar."""
    try:
        from calendar_writer import schedule_task
        result = schedule_task(
            task_title=request.task_title,
            duration_minutes=request.duration_minutes,
            preferred_slot=request.preferred_slot
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
    

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
