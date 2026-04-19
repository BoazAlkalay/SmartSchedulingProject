# SmartScheduler iPhone Shortcuts

Last updated: 2026-04-19

## What Now
**Purpose:** Get 2-3 task suggestions based on current energy and available time.
**Flow:**
1. Choose from menu: energy level (cantrip/low/medium/high/deep)
2. POST to `/what-now` with energy
3. Show response

## Add Task
**Purpose:** Add a new task via voice or text with LLM parsing and duplicate detection.
**Flow:**
1. Dictate text → DictatedText
2. POST to `/parse-task` → preview summary
3. Show Alert with parsed task summary
4. Choose from menu: Confirm, Edit, Cancel
   - Confirm → POST to `/add-task` with duplicate check
   - Edit → Ask for Input with default DictatedText → POST to `/add-task`
   - Cancel → Stop

## Check In
**Purpose:** Log current state — task, energy, mood, notes.
**Flow:**
1. Choose from menu: Full Check In, Just Logging
   - Full Check In:
     - GET `/tasks/titles` → Choose from list
     - Choose energy level
     - Ask for mood
     - Ask for notes
     - POST to `/checkin`
   - Just Logging:
     - Ask for notes (optional)
     - POST to `/checkin` with doing: "just logging"
2. Show Alert "Logged."

## Shift Everything (Panic)
**Purpose:** Reset all of today's scheduled tasks without judgment.
**Flow:**
1. Confirm alert "Reset today?"
2. POST to `/panic`
3. Show response message

## Stopping Now
**Purpose:** Save progress on a task and log a continuation note.
**Flow:**
1. GET `/tasks/titles` → Choose from list
2. Choose from menu: 25%, 50%, 75%, Almost Done, Not Much
   - Not Much → GET `/task-details` for current remaining
   - Others → Ask for estimated time remaining
3. Show Alert "Where did you leave off?"
4. Dictate continuation note
5. POST to `/stopping-now`
6. Show response

## Note to System
**Purpose:** Log an observation, complaint, or idea about the system.
**Flow:**
1. Choose from menu: Observation, Complaint, Idea
2. Dictate or type note
3. POST to `/note` with appropriate type
4. Show Alert "Logged."

## Done
**Purpose:** Mark a task complete, delete calendar event, log checkin.
**Flow:**
1. GET `/tasks/titles` → Choose from list
2. Ask for actual duration
3. Choose energy level
4. POST to `/complete-task`
5. Show Alert response

## What's Coming
**Purpose:** View merged calendar events and scheduled/planned tasks.
**Flow:**
1. Choose from menu: Today Remaining, Full Today, Two Days
2. GET `/whats-coming?scope=[choice]`
3. Get Dictionary Value `summary`
4. Show Alert with summary

## Try Again Later
**Purpose:** Reschedule a task to a specific future time.
**Flow:**
1. GET `/tasks/titles` → Choose from list
2. Ask for retry time (natural language e.g. "9pm today")
3. Ask for retry note (optional)
4. POST to `/retry`
5. Show response

## Schedule Task
**Purpose:** Manually schedule a task to a specific date and time.
**Flow:**
1. GET `/tasks/titles` → Choose from list → TaskTitle
2. Ask for duration (minutes) → Duration
3. Date picker → Format as yyyy-MM-dd → PreferredDate
4. Ask for time → PreferredTime
5. POST to `/schedule-task`
6. Calculate EndTime = StartTime + Duration
7. Calculate WarnTime = EndTime - 5 min
8. Create reminder: SmartScheduler — [task] — warning at WarnTime
9. Create reminder: SmartScheduler — [task] — end at EndTime
10. Show response

## Plan for Day
**Purpose:** Assign a planned date to one or more tasks without scheduling a time.
**Flow:**
1. GET `/tasks/titles` → Choose from list (multiple selection)
2. Date picker → Format as yyyy-MM-dd
3. Repeat for each selected task:
   - POST to `/plan-task`
   - Show confirmation
4. End Repeat

## Extend Task
**Purpose:** Extend the duration of a currently scheduled task.
**Flow:**
1. GET `/tasks/titles` → Choose from list
2. Choose from menu: 15, 30, 45, 60, Custom
   - Custom → Ask for Input (number)
   - Others → extract number from menu result
3. Find Reminders containing SmartScheduler — [task] → Remove
4. POST to `/extend-task`
5. Create new reminders with updated end time
6. Show response

## Health Check
**Purpose:** Confirm the server is running.
**Flow:**
1. GET `/health`
2. Get Dictionary Value `status`
3. Show Alert

## Propose Refinements
**Purpose:** Ask the LLM to propose updates to core_instructions.md.
**Flow:**
1. POST to `/propose-refinements`
2. Show Alert with response (open Obsidian to review pending_changes.md)

## Apply Refinements
**Purpose:** Apply approved changes from pending_changes.md.
**Flow:**
1. POST to `/apply-refinements`
2. Show Alert with response

## Reinitialize
**Purpose:** Rebuild core_instructions.md from scratch.
**Flow:**
1. POST to `/reinitialize`
2. Show Alert with response

## Planned Shortcuts (Not Yet Built)
- **Schedule Next / Queue Next** — schedule a task after the current contiguous block
- **Unschedule Task** — clear a task's schedule without setting a retry time