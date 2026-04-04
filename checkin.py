from pathlib import Path
from datetime import datetime
from config import CHECKINS

def create_checkin(
        doing: str,
        energy: str,
        slots_remaining: str = "unknown",
        mood: str = "",
        notes: str = ""
):
    """
    Create a new checkin file in the checkins folder.
    Called whenever you report what you are currently doing.
    """
    now = datetime.now()
    timestamp = now.strftime("%Y-%m-%d-%H%M")
    readable_time = now.strftime("%Y-%m-%d %H:%M")

    filename = f"{timestamp}.md"
    filepath = CHECKINS / filename

    content = f"""---
doing: {doing}
energy: {energy}
slots_remaining: {slots_remaining}
mood: {mood}
started: {readable_time}
---

## Notes
{notes}
"""
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    print(f"Checkin saved: {filename}")
    return filepath

def get_recent_checkins(days: int = 5):
    """
    Read the most recent checkin files.
    Keeps context lean by only loading recent history.
    """
    checkins = []
    cutoff = datetime.now().timestamp() - (days * 86400)

    for file in sorted(CHECKINS.glob("*.md"), reverse=True):
        if file.stat().st_mtime < cutoff:
            break
        with open(file, 'r', encoding='utf-8') as f:
            checkins.append(f.read())

    return checkins

if __name__ == "__main__":
    # test creating a checkin
    create_checkin(
        doing="setting up smart scheduler project",
        energy="medium",
        slots_remaining="2",
        mood="focused",
        notes="making good progress on the foundation"
    )
    # Test reading it back
    print("\n--- Recent checkins ---")
    recent = get_recent_checkins(days=1)
    for c in recent:
        print(c)
        print("---")