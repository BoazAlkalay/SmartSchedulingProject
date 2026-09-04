import json
import re
import frontmatter
import uuid
from pathlib import Path
from datetime import datetime, timezone, timedelta
from llm import ask
from config import INBOX, TASKS, RUNTIME_MODEL
from split_task import parse_duration_to_minutes


def clean_json_response(text: str) -> str:
    """
    strip markdown code fenses if the LLM wraps its JSON in them.
    """
    text = text.strip()
    text = re.sub(r"^```json\s*", "", text)
    text = re.sub(r"^```\s*", "", text)
    text = re.sub(r"```$", "", text)
    return text.strip()


def title_exists(title: str) -> bool:
    """
    Check if a task with this title already exists in the vault.
    """
    for filepath in list(TASKS.rglob("*.md")) + list(INBOX.rglob("*.md")):
        post = frontmatter.load(filepath)
        if post.metadata.get("title", "").lower() == title.lower():
            return True
    return False


def _build_date_context(now: datetime) -> dict:
    """
    Shared "what day/time is it, and what are the next 7 weekday dates"
    computation used by every parsing prompt. Pulled out so both
    parse_task_from_text() and add_task() always stay in sync.
    """
    # If it's the early hours (before ~3am), treat it as still "last night" —
    # relative date words like "today"/"tomorrow"/"next Monday" should follow
    # the day the person feels like they're in, not the literal calendar date.
    effective_now = now - timedelta(hours=3) if now.hour < 3 else now

    weekday_names = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ]
    next_weekdays = {}
    for i, name in enumerate(weekday_names):
        days_ahead = (i - effective_now.weekday()) % 7 or 7
        next_weekdays[name] = (effective_now + timedelta(days=days_ahead)).strftime(
            "%Y-%m-%d"
        )

    return {
        "effective_now": effective_now,
        "today": effective_now.strftime("%Y-%m-%d"),
        "day_of_week": effective_now.strftime("%A").lower(),
        "current_time": now.strftime("%H:%M"),  # actual clock time, unshifted
        "next_weekdays": next_weekdays,
    }


def _build_parse_prompt(raw_text: str, ctx: dict) -> str:
    """
    Shared prompt body for parsing natural language into one or more
    structured tasks. Single source of truth — used by both the preview
    endpoint (parse_task_from_text) and the actual creation endpoint
    (add_task), so the two can no longer drift out of sync.
    """
    today = ctx["today"]
    day_of_week = ctx["day_of_week"]
    current_time = ctx["current_time"]
    effective_now = ctx["effective_now"]
    next_weekdays = ctx["next_weekdays"]

    return f"""
Today is {today} ({day_of_week}) and the current time is {current_time}.
When the user says "today" the deadline is exactly {today}.
When the user says "tomorrow" the deadline is exactly {(effective_now + timedelta(days=1)).strftime("%Y-%m-%d")}.
When the user says "this week" the deadline is the coming Sunday.
When the user says "next Monday" the deadline is exactly {next_weekdays["monday"]}. When the user says "next Tuesday" the deadline is exactly {next_weekdays["tuesday"]}. When the user says "next Wednesday" the deadline is exactly {next_weekdays["wednesday"]}. When the user says "next Thursday" the deadline is exactly {next_weekdays["thursday"]}. When the user says "next Friday" the deadline is exactly {next_weekdays["friday"]}. When the user says "next Saturday" the deadline is exactly {next_weekdays["saturday"]}. When the user says "next Sunday" the deadline is exactly {next_weekdays["sunday"]}.

The exact same resolution applies to planned_date (the day the person intends to work on or do the task, as distinct from when it's due) whenever a relative day word implies one: "today" resolves to exactly {today}, "tomorrow" resolves to exactly {(effective_now + timedelta(days=1)).strftime("%Y-%m-%d")}, and a weekday name like "this Friday" or "next Monday" resolves to its date from the same anchors used for deadline above (e.g. Friday is exactly {next_weekdays["friday"]}). Both deadline and planned_date must always be either an actual YYYY-MM-DD date (with optional THH:MM for deadline) or null — NEVER the literal relative word itself ("today", "tomorrow", "friday", "next week", etc.). Resolve it to a real date before writing it into either field.

If the user mentions a specific time they want to DO the task AT (e.g. "at 3pm", "tonight at 8", "tomorrow morning at 9"), extract it as parsed_datetime in ISO format combining the resolved date and time. This is a scheduling request, not a deadline.

If the user mentions a specific time the task is due BY (e.g. "by 3pm", "before my 2pm meeting", "due at noon", "before 3:00pm"), include that time in the deadline field using YYYY-MM-DDTHH:MM (24-hour format), e.g. "2026-07-26T15:00". Do NOT put a "due by" time into parsed_datetime — that field is only for explicit "at X" requests. If no specific time is mentioned at all, use YYYY-MM-DD only for deadline.

Do NOT invent a deadline by adding duration_estimated to parsed_datetime, and do not invent one from a start time alone. A task that only states when it starts (parsed_datetime) has no deadline unless the user separately says so with "by"/"due"/"before" language — e.g. "virtual doctor's appointment at 1:45" has a parsed_datetime of 1:45 and deadline stays null; it does NOT imply a deadline of 1:45 plus the task's duration. When in doubt whether a stated time is a start time or a due-by time, prefer parsed_datetime and leave deadline null — a wrongly-invented deadline is worse than a missing one.

If the user mentions extra time needed before the deadline beyond the task itself — travel time, drive time, prep time, etc. — sum it into deadline_buffer_minutes as a single total number of minutes. If travel time is given "each direction" or "one way" and the task requires a round trip (drive there and back), DOUBLE it for the round trip total — e.g. "10-15 min to drive each direction" with a round trip implied means roughly 20-30 min total, so use ~25. If a range is given, use the higher end to be safe rather than the lower end. Only include time that's separate from duration_estimated itself. Leave null if nothing like this is mentioned.

If the user says a time like "at 6" or "at 9" with no AM/PM specified:
- If that time is more than 1 hour in the future today, assume today
- If that time has already passed today, assume tomorrow
- Default to PM for times 1-11 if context suggests daytime activity
- Default to AM for times 1-11 if context suggests morning activity (breakfast, wake up etc.)

If the person implies working on or starting this task on a DIFFERENT day than its deadline (e.g. "prep the presentation Wednesday, it's due Friday"), set suggested_schedule_date to that earlier working day. Only set this when such a distinction is actually implied — leave it null if the deadline and the intended working day are the same, or if no scheduling day was mentioned at all.

If the person explicitly asks to keep a record of each time a recurring task is completed (e.g. "log every time I do this", "keep a history of each one", "don't delete these after I finish them"), set preserve_completions to true. Otherwise leave it false — this only matters for recurring tasks, since non-recurring completions are judged individually anyway.

If the input specifies a total time range to complete across multiple chunks (e.g. "4-6 hours split into 25 and 45 minute chunks"), you MUST generate enough chunks so their combined duration_estimated sums to within that stated range — do not stop early just because a few tasks feel sufficient. If the input asks to spread tasks across a time period (e.g. "throughout the week"), assign DIFFERENT deadline and planned_date values across multiple distinct days within that period — do not put every task on the same day.

Parse the following into a task. Return ONLY a JSON object with these exact fields:
{{
    "title": "task title",
    "duration_estimated": "e.g. 45min or 2hr",
    "priority": "low, medium, high, or critical",
    "deadline": "YYYY-MM-DD, or YYYY-MM-DDTHH:MM if a specific due-by time was mentioned, or null",
    "deadline_buffer_minutes": "number of extra minutes needed before the deadline (travel, prep, etc.), or null",
    "planned_date": "YYYY-MM-DD or null",
    "suggested_schedule_date": "YYYY-MM-DD or null",
    "recurrence": "preserve exact frequency e.g. 'every week', 'twice a day', 'every 3 days', 'on mondays and wednesdays', or null",
    "preserve_completions": "true only if the person explicitly asked to keep a record of each completion of a recurring task, otherwise false",
    "energy_required": "cantrip, low, medium, high, or deep",
    "slot_level": 0-9,
    "preferred_days": ["monday", "wednesday"] or [],
    "preferred_time": "e.g. morning or null",
    "parsed_datetime": "e.g. 2026-07-17T15:00:00 if an explicit 'at X' scheduling request was mentioned, or null",
    "blocked_by": [],
    "tags": ["tag1", "tag2"],
    "folder": "which folder this belongs in e.g. tasks/work/deep-work",
    "notes": "any extra context worth capturing",
    "scheduling_instructions": "any specific scheduling constraints mentioned"
}}

If the input describes multiple related tasks or steps rather than one single task, return a JSON ARRAY of task objects instead of a single object — one object per task, each following the schema above. Use blocked_by with the exact title string of another task IN THIS SAME ARRAY that must be completed first, if applicable.

No explanation, no markdown, just the JSON object or array.

Input: {raw_text}
"""


def _compute_suggested_start(task_data: dict, now: datetime) -> None:
    """
    If the task has a deadline with a time component, back-calculate a
    suggested start time (deadline time minus duration minus buffer),
    computed here in Python rather than trusted from the LLM. Mutates
    task_data in place with:
      - suggested_start_time: "YYYY-MM-DDTHH:MM" or None
      - suggested_start_feasible: True / False / None (None = no time-deadline to check)
      - minutes_late_if_now: int or None — only set when infeasible; how
        late you'd finish if you started right now instead
    No-op (all fields None) if deadline has no time component.
    """
    deadline = task_data.get("deadline")
    if not deadline or "T" not in str(deadline):
        task_data["suggested_start_time"] = None
        task_data["suggested_start_feasible"] = None
        task_data["minutes_late_if_now"] = None
        return

    try:
        deadline_dt = datetime.fromisoformat(deadline)
    except (ValueError, TypeError):
        task_data["suggested_start_time"] = None
        task_data["suggested_start_feasible"] = None
        task_data["minutes_late_if_now"] = None
        return

    duration_minutes = parse_duration_to_minutes(
        task_data.get("duration_estimated", "")
    )

    buffer_minutes = task_data.get("deadline_buffer_minutes") or 0
    try:
        buffer_minutes = int(buffer_minutes)
    except (ValueError, TypeError):
        buffer_minutes = 0

    total_minutes = duration_minutes + buffer_minutes
    suggested_start_dt = deadline_dt - timedelta(minutes=total_minutes)

    task_data["suggested_start_time"] = suggested_start_dt.strftime("%Y-%m-%dT%H:%M")

    if suggested_start_dt < now:
        # Can't fit as originally scoped — report how late starting right now would land
        finish_if_now = now + timedelta(minutes=total_minutes)
        minutes_late = int((finish_if_now - deadline_dt).total_seconds() // 60)
        task_data["suggested_start_feasible"] = False
        task_data["minutes_late_if_now"] = max(minutes_late, 0)
    else:
        task_data["suggested_start_feasible"] = True
        task_data["minutes_late_if_now"] = None


def parse_task_from_text(raw_text: str) -> dict:
    """
    Takes natural language input and returns a structured task dictionary
    (or a list of dicts for multi-task input). Each returned task also
    carries a Python-computed suggested_start_time / feasibility check
    when its deadline includes a specific time.
    """
    now = datetime.now()
    ctx = _build_date_context(now)
    prompt = _build_parse_prompt(raw_text, ctx)

    response = ask(prompt)
    tasks = parse_llm_task_response(response)

    if not tasks:
        print(f"Failed to parse LLM response as JSON")
        print(f"Raw response: {response}")
        return None

    for t in tasks:
        _compute_suggested_start(t, now)

    return tasks[0] if len(tasks) == 1 else tasks


def create_task_file(
    task_data: dict, destination: Path = None, apply_suggested_dates: bool = True
) -> Path:
    """
    Takes a parsed task dictionary and writes it as a markdown file
    in the appropriate vault folder
    """

    # determine destination folder
    if destination is None:
        folder_path = task_data.get("folder", "inbox")
        if folder_path == "inbox":
            destination = INBOX
        else:
            # Normalize: strip leading "tasks/" if present, then re-root under TASKS
            # This prevents rogue folders at vault root if LLM omits "tasks/" prefix
            if folder_path.startswith("tasks/"):
                folder_path = folder_path[len("tasks/") :]
            destination = TASKS / folder_path

    # make sure folder exists
    destination.mkdir(parents=True, exist_ok=True)

    # create filename from title
    title = task_data.get("title", "untitled task")

    # Normalize: replace underscores with spaces, title-case
    title = title.replace("_", " ").strip()

    # Warn if duplicate title detected
    if title_exists(title):
        print(f"Warning: a task called '{title}' already exists.")
        print("Creating anyway — check your vault for duplicates.")

    import re

    safe_title = re.sub(r"[^\w\s]", "", title.lower())
    safe_title = safe_title.replace(" ", "_")
    safe_title = re.sub(r"_+", "_", safe_title)
    filename = f"{safe_title}.md"
    filepath = destination / filename

    # Handle filename collision as last resort
    counter = 2
    while filepath.exists():
        filename = f"{safe_title}_{counter}.md"
        filepath = destination / filename
        counter += 1

    deadline = task_data.get("deadline")
    parsed_dt = task_data.get("parsed_datetime")
    if deadline and parsed_dt:
        try:
            dt = datetime.fromisoformat(parsed_dt)
            if dt.strftime("%Y-%m-%d") == deadline:
                deadline = dt.strftime("%Y-%m-%dT%H:%M")
        except (ValueError, TypeError):
            pass

    planned_date = task_data.get("planned_date")
    suggested_date = task_data.get("suggested_schedule_date")
    if apply_suggested_dates and not planned_date and suggested_date:
        planned_date = suggested_date

    # build the frontmatter
    metadata = {
        "id": f"task_{uuid.uuid4().hex[:8]}",
        "title": title,
        "duration_estimated": task_data.get("duration_estimated", ""),
        "priority": task_data.get("priority", "medium"),
        "deadline": deadline,
        "suggested_schedule_date": task_data.get("suggested_schedule_date"),
        "planned_date": planned_date,
        "recurrence": task_data.get("recurrence"),
        "preserve_completions": task_data.get("preserve_completions", False),
        "status": "unscheduled",
        "progress": "0%",
        "remaining": task_data.get("duration_estimated", ""),
        "scheduled_time": None,
        # Informational only — the computed back-calculated start time from
        # a time-based deadline. Never auto-applied to scheduled_time/status
        # here, since that would silently commit a calendar-worthy decision
        # with no confirmation step (the interactive "Schedule at Suggested
        # Time" button is the deliberate accept step for that). This just
        # keeps the value from vanishing, especially for paths with no UI
        # to confirm through at all (iPhone Shortcuts dictation).
        "suggested_start_time": task_data.get("suggested_start_time"),
        "suggested_start_feasible": task_data.get("suggested_start_feasible"),
        "retry_at": None,
        "retry_note": None,
        "continuation_note": None,
        "blocked_by": task_data.get("blocked_by", []),
        "calendar_event_id": None,
        "times_deferred": 0,
        "energy_required": task_data.get("energy_required", "medium"),
        "slot_level": task_data.get("slot_level", 3),
        "preferred_time": task_data.get("preferred_time"),
        "preferred_days": task_data.get("preferred_days", []),
        "tags": task_data.get("tags", []),
        "created": datetime.now().strftime("%Y-%m-%d"),
    }

    # Build notes content
    notes_content = task_data.get("notes", "")
    scheduling_instructions = task_data.get("scheduling_instructions", "")

    content = "## Notes\n"
    if notes_content:
        content += f"{notes_content}\n"

    if scheduling_instructions:
        content += f"\n## Scheduling Instructions\n{scheduling_instructions}\n"

    # Write the file
    post = frontmatter.Post(content, **metadata)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(post))

    print(f"Task created: {filepath}")
    return filepath


def parse_llm_task_response(response: str) -> list:
    """
    Parse the LLM's response into a list of task dicts — handles a
    single object, a proper JSON array, or multiple back-to-back
    JSON objects/fenced blocks (which the LLM sometimes produces when
    a description naturally decomposes into related tasks).
    Always returns a list, even for a single task.
    """
    cleaned = clean_json_response(response)

    # Straightforward case: single object or a proper array
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError:
        pass

    # Fallback: strip ALL fences (not just first/last) and decode
    # sequential JSON objects one at a time
    text = re.sub(r"```json\s*", "", cleaned)
    text = re.sub(r"```", "", text).strip()

    decoder = json.JSONDecoder()
    tasks = []
    idx = 0
    while idx < len(text):
        while idx < len(text) and text[idx].isspace():
            idx += 1
        if idx >= len(text):
            break
        try:
            obj, end_idx = decoder.raw_decode(text, idx)
            tasks.append(obj)
            idx = end_idx
        except json.JSONDecodeError:
            break

    return tasks


def create_tasks_from_parsed(
    task_list: list, apply_suggested_dates: bool = True
) -> list:
    """
    Takes an already-parsed list of task dicts — e.g. straight from
    parse_task_from_text(), possibly after the person edited a field in
    the preview — and creates the actual task files: blocked_by
    resolution, root_id lineage, bidirectional wikilinks, console logging.

    This is the shared file-creation logic used by both add_task() (which
    parses raw text itself, below) and /add-task's parsed_tasks path
    (which skips parsing entirely, reusing whatever the preview already
    computed). Splitting this out closes the Add Task Re-Parse
    Architecture Gap: confirming a previewed task no longer re-parses the
    raw text a second time through an independent LLM call that could
    drift from what the preview showed.
    """
    if not task_list:
        return []

    # First pass: create every file, track title -> id / filepath
    title_to_id = {}
    title_to_filepath = {}
    root_id = None

    for i, task_data in enumerate(task_list):
        filepath = create_task_file(
            task_data, apply_suggested_dates=apply_suggested_dates
        )
        post = frontmatter.load(filepath)

        if i == 0:
            root_id = post.metadata.get("id")
        post.metadata["root_id"] = root_id

        with open(filepath, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(post))

        key = task_data.get("title", "").strip().lower()
        title_to_id[key] = post.metadata.get("id")
        title_to_filepath[key] = filepath

        print(f"\nCreated: {task_data.get('title')}")
        print(f"  Priority: {task_data.get('priority')}")
        print(
            f"  Energy: {task_data.get('energy_required')} (slot {task_data.get('slot_level')})"
        )
        print(f"  Duration: {task_data.get('duration_estimated')}")
        print(f"  Deadline: {task_data.get('deadline')}")

    # Second pass: resolve blocked_by title strings -> real ids,
    # and build a reverse map for "blocks" relationships
    blocks_map = {key: [] for key in title_to_filepath}

    for task_data in task_list:
        key = task_data.get("title", "").strip().lower()
        resolved_ids = []
        for ref in task_data.get("blocked_by", []) or []:
            ref_key = ref.strip().lower()
            if ref_key in title_to_id:
                resolved_ids.append(title_to_id[ref_key])
                blocks_map[ref_key].append(key)

        filepath = title_to_filepath[key]
        post = frontmatter.load(filepath)
        post.metadata["blocked_by"] = resolved_ids
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(frontmatter.dumps(post))

    # Third pass: write [[wikilinks]] under ## Related in both directions
    for task_data in task_list:
        key = task_data.get("title", "").strip().lower()
        filepath = title_to_filepath[key]
        post = frontmatter.load(filepath)

        related_lines = []
        for ref in task_data.get("blocked_by", []) or []:
            ref_key = ref.strip().lower()
            if ref_key in title_to_filepath:
                related_lines.append(
                    f"Blocked by: [[{title_to_filepath[ref_key].stem}]] ({ref})"
                )
        for blocked_key in blocks_map.get(key, []):
            blocked_title = next(
                (
                    t.get("title")
                    for t in task_list
                    if t.get("title", "").strip().lower() == blocked_key
                ),
                blocked_key,
            )
            related_lines.append(
                f"Blocks: [[{title_to_filepath[blocked_key].stem}]] ({blocked_title})"
            )

        if related_lines:
            post.content = (
                post.content.rstrip()
                + "\n\n## Related\n"
                + "\n".join(related_lines)
                + "\n"
            )
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(frontmatter.dumps(post))

    return list(title_to_filepath.values())


def add_task(raw_text: str, apply_suggested_dates: bool = True) -> list:
    """
    Main function — takes natural language and creates one or more linked
    task files. Parses raw_text itself via its own LLM call.

    If you already have parsed data (e.g. from a prior parse_task_from_text()
    call, as the Add Task preview does), call create_tasks_from_parsed()
    directly instead — that skips this redundant, potentially-drifting
    second parse entirely.
    """
    print(f"Parsing: '{raw_text}'")

    now = datetime.now()
    ctx = _build_date_context(now)
    prompt = _build_parse_prompt(raw_text, ctx)

    response = ask(prompt)
    task_list = parse_llm_task_response(response)

    if not task_list:
        print("Failed to parse task(s). Please try again.")
        return []

    for t in task_list:
        _compute_suggested_start(t, now)

    return create_tasks_from_parsed(
        task_list, apply_suggested_dates=apply_suggested_dates
    )


if __name__ == "__main__":
    # Test with a few different natural language inputs
    print("=== Test 1 ===")
    add_task(
        "read chapter 4 of text as data textbook, due thursday, medium energy, about 45 minutes"
    )

    print("\n=== Test 2 ===")
    add_task("schedule laundry sometime this weekend, low energy, 30 minutes")

    print("\n=== Test 3 ===")
    add_task(
        "prep for monday social networks class, high energy, need about an hour, prefer sunday morning"
    )
