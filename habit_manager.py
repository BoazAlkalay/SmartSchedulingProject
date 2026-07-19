import json
import uuid
from datetime import datetime
from pathlib import Path
from config import VAULT_PATH, HABIT_PERIODS

HABITS_DIR = VAULT_PATH / "habits"
HABIT_LOG_FILE = VAULT_PATH / "system/habit_log.json"


def create_habit(title: str, period: str) -> dict:
    """Create a new habit file in the vault."""
    import frontmatter

    HABITS_DIR.mkdir(parents=True, exist_ok=True)

    habit_id = f"habit_{uuid.uuid4().hex[:8]}"
    metadata = {
        "id": habit_id,
        "title": title,
        "period": period,
        "active": True,
        "created": datetime.now().strftime("%Y-%m-%d"),
    }

    safe_title = "".join(c if c.isalnum() or c == " " else "" for c in title.lower())
    safe_title = safe_title.replace(" ", "_")
    filepath = HABITS_DIR / f"{safe_title}.md"

    counter = 2
    while filepath.exists():
        filepath = HABITS_DIR / f"{safe_title}_{counter}.md"
        counter += 1

    post = frontmatter.Post("", **metadata)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(frontmatter.dumps(post))

    return metadata


def get_habits(period: str = None) -> list:
    """Return all active habits, optionally filtered by period."""
    import frontmatter

    if not HABITS_DIR.exists():
        return []

    habits = []
    for filepath in HABITS_DIR.glob("*.md"):
        post = frontmatter.load(filepath)
        if not post.metadata.get("active", True):
            continue
        if period and post.metadata.get("period") != period:
            continue
        habits.append(post.metadata)

    return habits


def load_habit_log() -> dict:
    """Load the full habit completion log (all dates)."""
    if not HABIT_LOG_FILE.exists():
        return {}
    with open(HABIT_LOG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_habit_log(log: dict) -> None:
    """Save the full habit completion log."""
    HABIT_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(HABIT_LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(log, f, indent=2)


def get_today_status(date_str: str = None) -> dict:
    """Return {habit_id: bool} for a given date (defaults to today)."""
    date_str = date_str or datetime.now().strftime("%Y-%m-%d")
    log = load_habit_log()
    return log.get(date_str, {})


def toggle_habit(habit_id: str, date_str: str = None) -> bool:
    """
    Flip a habit's completion status for a given date (defaults to today).
    Returns the new status (True = now complete).
    """
    date_str = date_str or datetime.now().strftime("%Y-%m-%d")
    log = load_habit_log()

    if date_str not in log:
        log[date_str] = {}

    current = log[date_str].get(habit_id, False)
    log[date_str][habit_id] = not current
    save_habit_log(log)

    return log[date_str][habit_id]


def get_current_period() -> str | None:
    """Return which period we're currently in ('morning'/'afternoon'/'evening'), or None if outside all periods."""
    current_time = datetime.now().strftime("%H:%M")
    for period, (start, end) in HABIT_PERIODS.items():
        if start <= current_time < end:
            return period
    return None


def get_badge_count(date_str: str = None) -> int:
    """
    Return the count of incomplete habits for the CURRENT period only.
    Used for the tab badge — doesn't nag about past periods.
    """
    period = get_current_period()
    if not period:
        return 0

    date_str = date_str or datetime.now().strftime("%Y-%m-%d")
    habits = get_habits(period=period)
    status = get_today_status(date_str)

    incomplete = [h for h in habits if not status.get(h["id"], False)]
    return len(incomplete)
