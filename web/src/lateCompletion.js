// How far past a scheduled block's end a completion counts as "late". Matches
// the 30-minute grace window truncate_calendar_event() already uses on the
// backend, so the prompt appears exactly when the calendar side stops
// guessing.
const LATE_GRACE_MINUTES = 30;

// `end` is a Date, or a local "YYYY-MM-DDTHH:MM" string (parsed by parts,
// not new Date(string), to avoid UTC offset surprises).
export function isLateCompletion(end) {
  if (!end) return false;
  let endDate = end;
  if (typeof end === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(end);
    if (!m) return false;
    endDate = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }
  return Date.now() > endDate.getTime() + LATE_GRACE_MINUTES * 60000;
}
