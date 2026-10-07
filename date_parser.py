"""
Deterministic natural-language date parsing -- no LLM involved.

Turns short phrases like "today", "yesterday", "friday 5pm", "in 3 days" or
"oct 12" into the date format task files use:

    YYYY-MM-DD            (date only)
    YYYY-MM-DDTHH:MM      (date with a time)

parse_natural_date() returns None when it can't fully understand the text, so
callers can refuse to save rather than writing a guess (or the raw words) into
a task file.
"""

import re
from datetime import datetime, timedelta

WEEKDAYS = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tue": 1,
    "tues": 1,
    "wednesday": 2,
    "wed": 2,
    "thursday": 3,
    "thu": 3,
    "thur": 3,
    "thurs": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}

MONTHS = {
    "january": 1,
    "jan": 1,
    "february": 2,
    "feb": 2,
    "march": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "may": 5,
    "june": 6,
    "jun": 6,
    "july": 7,
    "jul": 7,
    "august": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "sept": 9,
    "october": 10,
    "oct": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

NUMBER_WORDS = {
    "a": 1,
    "an": 1,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}

# Words that carry no date meaning and can be dropped before matching
FILLER_WORDS = {"at", "by", "on", "due", "the", "of", "@"}

_WEEKDAY_RE = "|".join(sorted(WEEKDAYS, key=len, reverse=True))
_MONTH_RE = "|".join(sorted(MONTHS, key=len, reverse=True))
_COUNT_RE = r"\d{1,3}|" + "|".join(NUMBER_WORDS)


def effective_now(now: datetime = None) -> datetime:
    """
    The moment relative date words are measured from.

    Before 3am it's treated as still "last night", so "today" at 1am means
    the day the person feels they're in. Same rule task entry uses (see
    _build_date_context in task_entry.py) and the web app's deadline labels
    use (see effectiveToday in TaskPool.jsx).
    """
    now = now or datetime.now()
    return now - timedelta(hours=3) if now.hour < 3 else now


def _extract_time(text: str):
    """
    Pull a clock time out of the text.
    Returns (remaining_text, (hour, minute) or None), or (None, None) if a
    time was written but isn't a real time (e.g. "25:00", "13pm").
    """
    # "noon"
    m = re.search(r"\bnoon\b", text)
    if m:
        return text[: m.start()] + " " + text[m.end() :], (12, 0)

    # 12-hour: "5pm", "5 pm", "5:30pm", "5:30 p.m."
    m = re.search(r"\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?", text)
    if m:
        hour, minute = int(m.group(1)), int(m.group(2) or 0)
        if not (1 <= hour <= 12 and 0 <= minute <= 59):
            return None, None
        if m.group(3) == "p" and hour != 12:
            hour += 12
        elif m.group(3) == "a" and hour == 12:
            hour = 0
        return text[: m.start()] + " " + text[m.end() :], (hour, minute)

    # 24-hour: "17:00"
    m = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
    if m:
        hour, minute = int(m.group(1)), int(m.group(2))
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None, None
        return text[: m.start()] + " " + text[m.end() :], (hour, minute)

    return text, None


def _count(word: str) -> int:
    return NUMBER_WORDS[word] if word in NUMBER_WORDS else int(word)


def _parse_date_part(text: str, base):
    """
    Resolve the date words (time already removed) to a date, measured from
    `base` (the effective today). Returns None if not fully understood.
    """
    if text in ("today", "tonight", "now"):
        return base
    if text == "yesterday":
        return base - timedelta(days=1)
    if text in ("tomorrow", "tmrw", "tmr"):
        return base + timedelta(days=1)
    if text == "day after tomorrow":
        return base + timedelta(days=2)
    if text == "day before yesterday":
        return base - timedelta(days=2)
    if text == "next week":
        return base + timedelta(days=7)
    if text == "last week":
        return base - timedelta(days=7)

    # "in 3 days", "in a week"
    m = re.fullmatch(rf"in ({_COUNT_RE}) (day|week)s?", text)
    if m:
        days = _count(m.group(1)) * (7 if m.group(2) == "week" else 1)
        return base + timedelta(days=days)

    # "3 days ago", "a week ago"
    m = re.fullmatch(rf"({_COUNT_RE}) (day|week)s? ago", text)
    if m:
        days = _count(m.group(1)) * (7 if m.group(2) == "week" else 1)
        return base - timedelta(days=days)

    # "last friday" -- the most recent one before today
    m = re.fullmatch(rf"(?:last|past|previous) ({_WEEKDAY_RE})", text)
    if m:
        days_back = (base.weekday() - WEEKDAYS[m.group(1)]) % 7 or 7
        return base - timedelta(days=days_back)

    # "friday", "this friday", "next friday" -- the coming one. If today is
    # that weekday it means a week from now (say "today" for today). Same
    # rule task entry and Plan-for-a-date already use.
    m = re.fullmatch(rf"(?:(?:this|next|coming|upcoming) )?({_WEEKDAY_RE})", text)
    if m:
        days_ahead = (WEEKDAYS[m.group(1)] - base.weekday()) % 7 or 7
        return base + timedelta(days=days_ahead)

    try:
        # "2026-10-12"
        m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", text)
        if m:
            return datetime(int(m.group(1)), int(m.group(2)), int(m.group(3))).date()

        # "oct 12", "october 12 2026", "12 oct"
        m = re.fullmatch(rf"({_MONTH_RE}) (\d{{1,2}})(?: (\d{{4}}))?", text)
        month_day_year = None
        if m:
            month_day_year = (MONTHS[m.group(1)], int(m.group(2)), m.group(3))
        else:
            m = re.fullmatch(rf"(\d{{1,2}}) ({_MONTH_RE})(?: (\d{{4}}))?", text)
            if m:
                month_day_year = (MONTHS[m.group(2)], int(m.group(1)), m.group(3))

        # "10/12", "10/12/2026", "10/12/26" -- month first
        if month_day_year is None:
            m = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{4}|\d{2}))?", text)
            if m:
                year = m.group(3)
                if year and len(year) == 2:
                    year = "20" + year
                month_day_year = (int(m.group(1)), int(m.group(2)), year)

        if month_day_year:
            month, day, year = month_day_year
            if year:
                return datetime(int(year), month, day).date()
            # No year given: assume this year, unless that lands more than
            # ~6 months back, in which case the coming one was meant.
            candidate = datetime(base.year, month, day).date()
            if candidate < base - timedelta(days=180):
                candidate = datetime(base.year + 1, month, day).date()
            return candidate
    except ValueError:
        return None  # not a real calendar date, e.g. "feb 30"

    return None


def parse_natural_date(text: str, now: datetime = None) -> str | None:
    """
    Parse a short natural-language date into YYYY-MM-DD, or YYYY-MM-DDTHH:MM
    if a time was given. Returns None if the text isn't fully understood.

    Understands:
      today, tonight, yesterday, tomorrow, day after tomorrow
      friday / this friday / next friday (the coming one), last friday
      in 3 days, in a week, 3 days ago, a week ago, next week, last week
      oct 12, october 12 2026, 12 oct, 10/12, 10/12/2026
      2026-10-12, 2026-10-12T17:00, 2026-10-12 17:00
      ...any of the above with a time: "friday 5pm", "tomorrow at 17:00",
         "today by 3:30 pm", "oct 12 noon"
      a time on its own ("5pm") -- the next time the clock reads that

    Relative words are measured from effective_now(), so before 3am "today"
    still means the previous calendar day.
    """
    now = now or datetime.now()
    if not text or not text.strip():
        return None

    cleaned = text.strip().lower()
    # Exact machine format first, so stored values round-trip untouched
    cleaned = re.sub(r"^(\d{4}-\d{1,2}-\d{1,2})t(\d{1,2}:\d{2})$", r"\1 \2", cleaned)
    cleaned = cleaned.replace(",", " ")

    cleaned, clock = _extract_time(cleaned)
    if cleaned is None:
        return None

    # "12th" -> "12", then drop filler words and tidy spacing
    cleaned = re.sub(r"\b(\d{1,2})(?:st|nd|rd|th)\b", r"\1", cleaned)
    words = [w for w in cleaned.split() if w not in FILLER_WORDS]
    date_text = " ".join(words)

    if not date_text:
        if clock is None:
            return None
        # Time on its own: the next time the clock reads that, by the real
        # clock (so "5pm" at 1am means this coming afternoon).
        moment = now.replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)
        if moment <= now:
            moment += timedelta(days=1)
        return moment.strftime("%Y-%m-%dT%H:%M")

    date = _parse_date_part(date_text, effective_now(now).date())
    if date is None:
        return None

    if clock is None:
        return date.strftime("%Y-%m-%d")
    return f"{date.strftime('%Y-%m-%d')}T{clock[0]:02d}:{clock[1]:02d}"
