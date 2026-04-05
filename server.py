from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional
import uvicorn

from what_now import what_now
from task_entry import add_task
from reschedule import panic_button, stopping_now, retry_later
from checkin import create_checkin


app = FastAPI(title="Smart Scheduler")

# --- Requests Models ---
# these define what each endpint expects to receive

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



# --- Endpoints ---

@app.get("/health")
def health_check():
    """Quick check that the server is running"""
    return {"status": "ok"}

@app.post("/what-now")
def get_what_now(request: WhatNowRequest):
    """
    What should I do right now?
    """
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
    """
    Add a new task from natural language.
    """
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
    



if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )