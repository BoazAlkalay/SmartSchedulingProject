from datetime import datetime
from anthropic import Anthropic
from config import VAULT_PATH
import re
import json

client = Anthropic()


def suggest_brackets_today(context: str = "", target_date: str = None) -> dict:
    """
    Propose one-off (specific_date) brackets for a given date based on
    calendar, existing brackets, unscheduled tasks, and soft_schedule
    preferences. Returns proposals for review — does NOT save them.
    """
    from generate_schedule import get_busy_blocks, get_tasks_for_scheduling
    from bracket_manager import get_brackets_for_date
    from system_reader import read_system_file
    from config import SOFT_SCHEDULE

    today_str = target_date or datetime.now().strftime("%Y-%m-%d")
    today_name = datetime.strptime(today_str, "%Y-%m-%d").strftime("%A")
    current_time = datetime.now().strftime("%H:%M")
    is_today = today_str == datetime.now().strftime("%Y-%m-%d")

    existing_brackets = get_brackets_for_date(today_str)
    busy = get_busy_blocks(today_str)
    tasks = get_tasks_for_scheduling(scope_days=1)
    soft_schedule = read_system_file(SOFT_SCHEDULE)

    # Format existing brackets so the LLM doesn't duplicate them
    existing_text = "No brackets currently set for today.\n"
    if existing_brackets:
        existing_text = "Existing brackets today:\n"
        for b in existing_brackets:
            existing_text += (
                f"  - {b['name']} ({b['color']}): {b['start_time']}-{b['end_time']}"
            )
            if b.get("description"):
                existing_text += f" — {b['description']}"
            existing_text += "\n"

    # Format busy blocks
    busy_text = "No existing commitments today.\n"
    if busy:
        busy_text = "Busy blocks today (calendar + already scheduled):\n"
        for b in busy:
            busy_text += f"  - {b['start']} - {b['end']}: {b['title']}\n"

    # Format tasks (just enough to spot patterns, not full detail)
    task_text = "No unscheduled tasks.\n"
    if tasks:
        task_text = "Unscheduled/in-progress tasks today:\n"
        for t in tasks:
            task_text += f"  - {t['title']} | {t['duration']} | energy:{t['energy']} | folder:{t['folder']}\n"

    prompt = f"""You are proposing time-block "brackets" for a personal scheduling system called SmartScheduler, for TODAY ONLY ({today_name} {today_str}).

Brackets are either:
- "schedule" (green) — a window suggesting what kind of task should go there
- "block" (red) — a window where nothing should be scheduled

{existing_text}
{busy_text}
{task_text}
Soft schedule preferences:
{soft_schedule}

{f'User context for today: {context}' if context else 'No additional context provided.'}

{f"Current time is {current_time}. Do not propose any bracket with a start_time before {current_time} — today is already partially over, only propose brackets for the remaining part of the day." if is_today else f"You are planning for a future day ({today_name} {today_str}), not today — the full day from morning onward is available, there is no 'current time' constraint for this date."}

Propose 0-4 NEW brackets for today only. Do not duplicate or overlap existing brackets or busy blocks.
Only propose a bracket if it would genuinely help — it's fine to propose none if today already looks well covered.
These are ONE-OFF brackets for today only, not recurring.

Return ONLY a JSON array like this, no other text:
[
  {{
    "name": "short bracket name",
    "type": "schedule or block",
    "color": "green or red",
    "start_time": "HH:MM",
    "end_time": "HH:MM",
    "description": "what kind of tasks belong here, or why this time is blocked",
    "reason": "one sentence explaining why you're proposing this for today specifically"
  }}
]"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = response.content[0].text.strip()

    # Strip markdown code blocks if present
    raw = re.sub(r"^```json\s*", "", raw)
    raw = re.sub(r"^```\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        proposals = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"JSON parse error in suggest_brackets_today: {e}")
        print(f"Raw response: {raw}")
        return {
            "status": "error",
            "message": "LLM returned invalid JSON",
            "proposals": [],
        }

    # Attach specific_date and a temp id so the frontend can track/edit
    # each proposal before it's committed to schedule_brackets.json
    import uuid

    for p in proposals:
        p["specific_date"] = today_str
        p["days"] = []
        p["reflections"] = ""
        p["active"] = True
        p["proposal_id"] = f"proposal_{uuid.uuid4().hex[:8]}"

    # Filter out any proposal starting before the current time —
    # only relevant when proposing for today; a future date has no "past" to filter
    valid_proposals = []
    for p in proposals:
        try:
            if not is_today or p.get("start_time", "00:00") >= current_time:
                valid_proposals.append(p)
            else:
                print(
                    f"Filtered past-time proposal: {p.get('name')} at {p.get('start_time')}"
                )
        except Exception:
            valid_proposals.append(p)

    proposals = valid_proposals

    return {
        "status": "generated",
        "date": today_str,
        "proposals": proposals,
        "count": len(proposals),
    }
