import React from "react";

const API = `http://${window.location.hostname}:8000`;

const STEPS = {
  INPUT: "input",
  PREVIEW: "preview",
  DUPLICATE: "duplicate",
  DONE: "done",
};

// Preview-row fields editable with a plain text or select input (the
// date-based ones -- deadline, planned_date -- have their own editor
// above since they need a date/time picker instead).
const SIMPLE_FIELDS = {
  title: { type: "text", placeholder: "Task title" },
  duration_estimated: {
    type: "text",
    placeholder: "e.g. 45min, 2hr",
    allowEmpty: true,
  },
  priority: {
    type: "select",
    options: ["low", "medium", "high", "critical"],
  },
  energy_required: {
    type: "select",
    options: ["cantrip", "low", "medium", "high", "deep"],
  },
  folder: { type: "text", placeholder: "e.g. tasks/work/deep-work" },
  tags: {
    type: "text",
    isList: true,
    placeholder: "comma, separated, tags",
    allowEmpty: true,
    allowClear: true,
  },
  recurrence: {
    type: "text",
    placeholder: "e.g. every week (blank = none)",
    allowEmpty: true,
    allowClear: true,
  },
  notes: {
    type: "textarea",
    placeholder: "Any extra context or details...",
    allowEmpty: true,
    allowClear: true,
  },
};

export default function AddTaskModal({ onClose, onRefresh, initialText = "" }) {
  const [step, setStep] = React.useState(STEPS.INPUT);
  const [text, setText] = React.useState(initialText);
  const [initialTextValue] = React.useState(initialText);
  const [parsed, setParsed] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [result, setResult] = React.useState("");
  const [showScheduleAt, setShowScheduleAt] = React.useState(false);
  // Free-text, natural-language date+time ("friday 6pm", "tomorrow 9am",
  // or the machine-format prefill below) -- resolved through /parse-date
  // on submit, so both the date AND the time can be changed here, not
  // just the time.
  const [scheduleAtInput, setScheduleAtInput] = React.useState("");
  const [parsedTasks, setParsedTasks] = React.useState(null);
  // Which preview field is being edited inline right now: "deadline",
  // "planned_date", one of SIMPLE_FIELDS's keys, or null when nothing is
  // open.
  const [editingField, setEditingField] = React.useState(null);
  const [editDateVal, setEditDateVal] = React.useState("");
  const [editTimeVal, setEditTimeVal] = React.useState("");
  const [editSimpleVal, setEditSimpleVal] = React.useState("");

  async function handleParse() {
    if (!text.trim()) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API}/parse-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.status === "parsed") {
        if (data.multi) {
          setParsedTasks(data.tasks);
          setParsed(null);
        } else {
          setParsed(data.task);
          setParsedTasks(null);
        }
        setStep(STEPS.PREVIEW);
      } else {
        setError("Failed to parse task. Try again.");
      }
    } catch (err) {
      setError("Could not reach server.");
    }
    setLoading(false);
  }

  async function handleAdd(scheduleMode, force = false) {
    setLoading(true);

    // Send the already-parsed preview data straight through instead of
    // re-sending raw text — /add-task no longer re-parses in this case,
    // so the created file is guaranteed to match exactly what the preview
    // showed (title included), closing the Add Task Re-Parse
    // Architecture Gap for the single-task path.
    const addRes = await fetch(`${API}/add-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parsed_tasks: [parsed], force }),
    });
    const addData = await addRes.json();

    if (addData.status === "duplicate") {
      setStep(STEPS.DUPLICATE);
      setLoading(false);
      return;
    }

    if (addData.status !== "created") {
      setError("Failed to create task.");
      setLoading(false);
      return;
    }

    // No longer a guess — this is the exact title just written to disk,
    // since we sent the parsed data directly rather than re-parsing.
    const exactTitle = addData.titles?.[0] || parsed.title;

    if (scheduleMode === "find-slot") {
      const duration = parseDurationToMinutes(parsed.duration_estimated);
      const slotRes = await fetch(`${API}/find-slot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration_minutes: duration }),
      });
      const slotData = await slotRes.json();

      if (slotData.status === "found") {
        const slotStart = new Date(slotData.start_iso);
        const hours = String(slotStart.getHours()).padStart(2, "0");
        const minutes = String(slotStart.getMinutes()).padStart(2, "0");
        const now = new Date();
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        await fetch(`${API}/schedule-task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_title: exactTitle,
            duration_minutes: duration,
            preferred_start: `${hours}:${minutes}`,
            preferred_date: date,
          }),
        });
        setResult(`Scheduled for ${slotData.start} – ${slotData.end}`);
      } else {
        setResult("Added to unscheduled — no free slot found today.");
      }
    } else if (scheduleMode === "schedule-at") {
      const duration = parseDurationToMinutes(parsed.duration_estimated);
      // scheduleAtInput is natural language covering BOTH the date and
      // the time ("friday 6pm", "tomorrow 9am", or the exact machine
      // string this form was pre-filled with) -- resolved through the
      // same deterministic date_parser.py that Change Deadline uses, so
      // editing the date here (not just the time) actually works,
      // instead of silently staying on whatever date the parsed preview
      // happened to compute.
      let parseRes;
      try {
        parseRes = await fetch(`${API}/parse-date`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: scheduleAtInput }),
        });
      } catch {
        setError("Could not reach server.");
        setLoading(false);
        return;
      }
      const parseData = await parseRes.json();
      if (parseData.status !== "parsed") {
        setError(parseData.message || `Couldn't understand "${scheduleAtInput}".`);
        setLoading(false);
        return;
      }
      if (!parseData.value.includes("T")) {
        setError(
          `"${scheduleAtInput}" has a date but no time — try e.g. "friday 6pm".`,
        );
        setLoading(false);
        return;
      }
      const [schedulingDate, schedulingTime] = parseData.value.split("T");
      await fetch(`${API}/schedule-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: exactTitle,
          duration_minutes: duration,
          preferred_start: schedulingTime,
          preferred_date: schedulingDate,
        }),
      });
      setResult(`Scheduled for ${schedulingTime} on ${schedulingDate}`);
    } else if (scheduleMode === "now") {
      const now = new Date();
      const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      const duration = parseDurationToMinutes(parsed.duration_estimated);
      await fetch(`${API}/schedule-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: exactTitle,
          duration_minutes: duration,
          preferred_start: `${hours}:${minutes}`,
          preferred_date: date,
        }),
      });
      setResult(`Scheduled now until ${getEndTime(now, duration)}`);
    } else {
      // A planned_date (own or mirrored from suggested_schedule_date by
      // create_task_file) means this isn't really "unscheduled" -- it
      // already has a day, just no specific time slot yet.
      const effectivePlanned = parsed.planned_date || parsed.suggested_schedule_date;
      setResult(
        effectivePlanned
          ? `Planned for ${formatDateOnly(effectivePlanned)}.`
          : "Added to unscheduled.",
      );
    }

    setStep(STEPS.DONE);
    setLoading(false);
    onRefresh();
  }

  async function handleAddMulti() {
    setLoading(true);
    const addRes = await fetch(`${API}/add-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parsed_tasks: parsedTasks, force: false }),
    });
    const addData = await addRes.json();

    if (addData.status !== "created") {
      setError("Failed to create tasks.");
      setLoading(false);
      return;
    }

    setResult(
      `Added ${addData.count} linked tasks — check the task pool to schedule them.`,
    );
    setStep(STEPS.DONE);
    setLoading(false);
    onRefresh();
  }

  function parseDurationToMinutes(duration) {
    if (!duration) return 60;
    let minutes = 0;
    const hrMatch = duration.match(/([\d.]+)\s*hr/);
    const minMatch = duration.match(/(\d+)\s*min/);
    if (hrMatch) minutes += parseFloat(hrMatch[1]) * 60;
    if (minMatch) minutes += parseInt(minMatch[1]);
    return minutes || 60;
  }

  function getEndTime(start, durationMinutes) {
    const end = new Date(start.getTime() + durationMinutes * 60000);
    return `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  }

  // Date-only strings ("YYYY-MM-DD") must be split and built with
  // new Date(year, month-1, day) rather than new Date(string) — the
  // latter parses as UTC midnight and can shift a day off in local time.
  function formatDateOnly(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString("default", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  // Date-time strings ("YYYY-MM-DDTHH:MM") parse fine with new Date()
  // since they have no timezone suffix, so JS treats them as local time.
  function formatDateTime(dtStr) {
    if (!dtStr) return null;
    const dt = new Date(dtStr);
    return dt.toLocaleString("default", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatDeadline(deadline) {
    if (!deadline) return "none";
    return deadline.includes("T")
      ? formatDateTime(deadline)
      : formatDateOnly(deadline);
  }

  // Mirrors _compute_suggested_start in task_entry.py so an inline edit
  // to the deadline updates "Suggested start" immediately instead of
  // showing a stale value from the original parse until the task is
  // actually created.
  function recomputeSuggestedStart(task) {
    const deadline = task.deadline;
    if (!deadline || !deadline.includes("T")) {
      return {
        ...task,
        suggested_start_time: null,
        suggested_start_feasible: null,
        minutes_late_if_now: null,
      };
    }
    const deadlineDt = new Date(deadline);
    if (isNaN(deadlineDt.getTime())) {
      return {
        ...task,
        suggested_start_time: null,
        suggested_start_feasible: null,
        minutes_late_if_now: null,
      };
    }
    const durationMinutes = parseDurationToMinutes(task.duration_estimated);
    const bufferMinutes = Number(task.deadline_buffer_minutes) || 0;
    const totalMinutes = durationMinutes + bufferMinutes;
    const suggestedStartDt = new Date(
      deadlineDt.getTime() - totalMinutes * 60000,
    );
    const pad = (n) => String(n).padStart(2, "0");
    const suggestedStartStr =
      `${suggestedStartDt.getFullYear()}-${pad(suggestedStartDt.getMonth() + 1)}-` +
      `${pad(suggestedStartDt.getDate())}T${pad(suggestedStartDt.getHours())}:${pad(suggestedStartDt.getMinutes())}`;

    const now = new Date();
    if (suggestedStartDt < now) {
      const finishIfNow = new Date(now.getTime() + totalMinutes * 60000);
      const minutesLate = Math.max(
        0,
        Math.round((finishIfNow - deadlineDt) / 60000),
      );
      return {
        ...task,
        suggested_start_time: suggestedStartStr,
        suggested_start_feasible: false,
        minutes_late_if_now: minutesLate,
      };
    }
    return {
      ...task,
      suggested_start_time: suggestedStartStr,
      suggested_start_feasible: true,
      minutes_late_if_now: null,
    };
  }

  // deadline and parsed_datetime carry a time; planned_date is date-only.
  const DATE_FIELD_WITH_TIME = { deadline: true, parsed_datetime: true, planned_date: false };

  function todayStr() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function openEdit(field) {
    const raw = parsed[field];
    if (raw && raw.includes("T")) {
      const [d, t] = raw.split("T");
      setEditDateVal(d);
      setEditTimeVal(t.slice(0, 5));
    } else {
      setEditDateVal(raw || "");
      setEditTimeVal("");
    }
    setError("");
    setEditingField(field);
  }

  function cancelEdit() {
    setError("");
    setEditingField(null);
  }

  function saveEdit(field) {
    if (!editDateVal) {
      cancelEdit();
      return;
    }
    // The date input's min/max attributes are only a hint -- several
    // mobile browsers (notably iOS Safari's wheel picker) let you pick
    // outside that range without greying anything out or blocking the
    // value, so this is the actual enforcement. On a reject, the editor
    // stays open (no setEditingField(null)) so the date can be fixed
    // instead of silently discarding the edit.
    if (field === "planned_date") {
      const today = todayStr();
      if (editDateVal < today) {
        setError(`Planned for can't be in the past — pick ${formatDateOnly(today)} or later.`);
        return;
      }
      if (parsed.deadline) {
        const deadlineDate = parsed.deadline.split("T")[0];
        if (editDateVal > deadlineDate) {
          setError(
            `Planned for can't be after the deadline (${formatDateOnly(deadlineDate)}).`,
          );
          return;
        }
      }
    }
    setError("");
    const value =
      DATE_FIELD_WITH_TIME[field] && editTimeVal
        ? `${editDateVal}T${editTimeVal}`
        : editDateVal;
    setParsed((prev) => {
      const updated = { ...prev, [field]: value };
      return field === "deadline" ? recomputeSuggestedStart(updated) : updated;
    });
    setEditingField(null);
  }

  function clearField(field) {
    setParsed((prev) => {
      const updated = { ...prev, [field]: null };
      return field === "deadline" ? recomputeSuggestedStart(updated) : updated;
    });
    setEditingField(null);
  }

  // --- Simple text/select fields (title, duration, priority, energy,
  // folder, tags, recurrence) -- same click-to-edit pattern as the date
  // fields above, driven by the SIMPLE_FIELDS config instead of one
  // hand-written editor per field. ---

  function openSimpleEdit(field) {
    const cfg = SIMPLE_FIELDS[field];
    let raw = parsed[field];
    raw = cfg.isList ? (Array.isArray(raw) ? raw.join(", ") : "") : raw ?? "";
    setEditSimpleVal(raw);
    setEditingField(field);
  }

  function saveSimpleEdit(field) {
    const cfg = SIMPLE_FIELDS[field];
    const trimmed = editSimpleVal.trim();
    if (!trimmed && !cfg.allowEmpty) {
      cancelEdit(); // blank isn't valid for this field -- discard, don't save garbage
      return;
    }
    const value = cfg.isList
      ? trimmed
        ? trimmed
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : []
      : trimmed || null;
    setParsed((prev) => ({ ...prev, [field]: value }));
    setEditingField(null);
  }

  function clearSimpleEdit(field) {
    const cfg = SIMPLE_FIELDS[field];
    setParsed((prev) => ({ ...prev, [field]: cfg.isList ? [] : null }));
    setEditingField(null);
  }

  function renderEditableValue(field, displayValue) {
    const cfg = SIMPLE_FIELDS[field];
    if (editingField === field) {
      const stacked = cfg.type === "textarea";
      return (
        <div className={stacked ? "inline-edit inline-edit-stacked" : "inline-edit"}>
          {cfg.type === "select" ? (
            <select
              value={editSimpleVal}
              onChange={(e) => setEditSimpleVal(e.target.value)}
              autoFocus
            >
              {cfg.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : cfg.type === "textarea" ? (
            <textarea
              value={editSimpleVal}
              placeholder={cfg.placeholder}
              onChange={(e) => setEditSimpleVal(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds a newline here instead of submitting --
                // only Escape gets a shortcut; Save is an explicit click.
                if (e.key === "Escape") cancelEdit();
              }}
              rows={3}
              autoFocus
            />
          ) : (
            <input
              type="text"
              value={editSimpleVal}
              placeholder={cfg.placeholder}
              onChange={(e) => setEditSimpleVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveSimpleEdit(field);
                if (e.key === "Escape") cancelEdit();
              }}
              autoFocus
            />
          )}
          <div className="inline-edit-buttons">
            <button
              className="btn-ghost btn-xs"
              onClick={() => saveSimpleEdit(field)}
            >
              Save
            </button>
            {cfg.allowClear && (
              <button
                className="btn-ghost btn-xs"
                onClick={() => clearSimpleEdit(field)}
              >
                Clear
              </button>
            )}
            <button className="btn-ghost btn-xs" onClick={cancelEdit}>
              ✕
            </button>
          </div>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="preview-value preview-value-editable"
        onClick={() => openSimpleEdit(field)}
        title="Click to change"
      >
        {displayValue}
      </button>
    );
  }

  // Shared editor for the three date-bearing fields (deadline,
  // planned_date, parsed_datetime) -- withTime controls whether a time
  // input is shown alongside the date picker.
  function renderDateEditable(field, withTime, displayValue, valueStyle) {
    if (editingField === field) {
      // planned_date is the one case where there's a real window to
      // constrain to: no earlier than today, no later than the
      // deadline (if one is set). The browser's own date picker greys
      // out everything outside [min, max] -- cheaper and more
      // discoverable than a custom calendar, and it's exactly the
      // "reasonable to schedule" range.
      let min, max;
      if (field === "planned_date") {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        if (parsed.deadline) max = parsed.deadline.split("T")[0];
      }
      return (
        <div className="inline-edit">
          <input
            type="date"
            value={editDateVal}
            min={min}
            max={max}
            onChange={(e) => setEditDateVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveEdit(field);
              if (e.key === "Escape") cancelEdit();
            }}
            autoFocus
          />
          {withTime && (
            <input
              type="time"
              value={editTimeVal}
              onChange={(e) => setEditTimeVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEdit(field);
                if (e.key === "Escape") cancelEdit();
              }}
            />
          )}
          <button className="btn-ghost btn-xs" onClick={() => saveEdit(field)}>
            Save
          </button>
          <button
            className="btn-ghost btn-xs"
            onClick={() => clearField(field)}
          >
            Clear
          </button>
          <button className="btn-ghost btn-xs" onClick={cancelEdit}>
            ✕
          </button>
        </div>
      );
    }
    return (
      <button
        type="button"
        className="preview-value preview-value-editable"
        onClick={() => openEdit(field)}
        title="Click to change"
        style={valueStyle}
      >
        {displayValue}
      </button>
    );
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Add Task</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {/* Step 1 — Input */}
          {step === STEPS.INPUT && (
            <div className="checkin-form">
              <div className="form-field">
                <label>Describe the task</label>
                <textarea
                  rows={3}
                  placeholder="e.g. read chapter 4, due thursday, 45 min, medium energy"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleParse();
                    }
                  }}
                />
              </div>
              {error && (
                <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
              )}
              <button
                className="btn-primary"
                onClick={handleParse}
                disabled={
                  loading ||
                  !text.trim() ||
                  text.trim() === initialTextValue.trim()
                }
                style={{ width: "100%" }}
              >
                {loading ? "Parsing..." : "Parse →"}
              </button>
            </div>
          )}

          {/* Step 2 — Preview */}
          {step === STEPS.PREVIEW && parsed && (
            <div className="checkin-form">
              {/* Edit link */}
              <button
                className="edit-link"
                onClick={() => setStep(STEPS.INPUT)}
                disabled={loading}
              >
                ← edit input
              </button>

              <div className="task-preview">
                <div className="preview-row">
                  <span className="preview-label">Title</span>
                  {renderEditableValue("title", parsed.title)}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Duration</span>
                  {renderEditableValue(
                    "duration_estimated",
                    parsed.duration_estimated || "none",
                  )}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Energy</span>
                  {renderEditableValue("energy_required", parsed.energy_required)}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Priority</span>
                  {renderEditableValue("priority", parsed.priority)}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Due by</span>
                  {renderDateEditable(
                    "deadline",
                    true,
                    formatDeadline(parsed.deadline),
                  )}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Planned for</span>
                  {renderDateEditable(
                    "planned_date",
                    false,
                    parsed.planned_date
                      ? formatDateOnly(parsed.planned_date)
                      : parsed.suggested_schedule_date
                        ? `${formatDateOnly(parsed.suggested_schedule_date)} (suggested)`
                        : parsed.deadline
                          ? `flexible — any day until ${formatDateOnly(parsed.deadline.split("T")[0])}`
                          : "not yet placed",
                  )}
                </div>
                {parsed.suggested_start_time && (
                  <div className="preview-row">
                    <span className="preview-label">
                      {parsed.suggested_start_feasible === false
                        ? "Heads up"
                        : "Suggested start"}
                    </span>
                    <span
                      className="preview-value"
                      style={{
                        color:
                          parsed.suggested_start_feasible === false
                            ? "var(--amber)"
                            : "var(--green)",
                      }}
                    >
                      {parsed.suggested_start_feasible === false
                        ? `Can't fit before the deadline — starting now would finish ~${parsed.minutes_late_if_now} min late`
                        : formatDateTime(parsed.suggested_start_time)}
                    </span>
                  </div>
                )}
                <div className="preview-row">
                  <span className="preview-label">Folder</span>
                  {renderEditableValue("folder", parsed.folder || "none")}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Tags</span>
                  {renderEditableValue(
                    "tags",
                    parsed.tags?.length > 0 ? parsed.tags.join(", ") : "none",
                  )}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Recurrence</span>
                  {renderEditableValue("recurrence", parsed.recurrence || "none")}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Notes</span>
                  {renderEditableValue(
                    "notes",
                    parsed.notes
                      ? parsed.notes.length > 60
                        ? `${parsed.notes.slice(0, 60)}…`
                        : parsed.notes
                      : "none",
                  )}
                </div>
                <div className="preview-row">
                  <span className="preview-label">Requested time</span>
                  {renderDateEditable(
                    "parsed_datetime",
                    true,
                    parsed.parsed_datetime
                      ? formatDateTime(parsed.parsed_datetime)
                      : "none",
                    parsed.parsed_datetime ? { color: "var(--green)" } : undefined,
                  )}
                </div>
              </div>

              {error && (
                <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
              )}

              {/* Schedule At inline form */}
              {showScheduleAt && (
                <div className="schedule-at-form">
                  <div className="form-field">
                    <label>When? (date and time)</label>
                    <input
                      type="text"
                      placeholder="e.g. friday 6pm, tomorrow 9am, oct 25 2pm"
                      value={scheduleAtInput}
                      onChange={(e) => setScheduleAtInput(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAdd("schedule-at");
                      }}
                    />
                  </div>
                  <div className="add-task-buttons">
                    <button
                      className="btn-ghost"
                      onClick={() => setShowScheduleAt(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleAdd("schedule-at")}
                      disabled={loading || !scheduleAtInput.trim()}
                    >
                      {loading ? "..." : "Schedule"}
                    </button>
                  </div>
                </div>
              )}

              {!showScheduleAt && (
                <div className="add-task-buttons-grid">
                  <button
                    className="btn-ghost"
                    onClick={() => handleAdd("backlog")}
                    disabled={loading}
                  >
                    {parsed.planned_date || parsed.suggested_schedule_date
                      ? "Add as Planned"
                      : "Add to Unscheduled"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => handleAdd("find-slot")}
                    disabled={loading}
                  >
                    {loading ? "..." : "Add & Find Slot"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      let dt = null;
                      if (
                        parsed.suggested_start_time &&
                        parsed.suggested_start_feasible !== false
                      ) {
                        dt = new Date(parsed.suggested_start_time);
                      } else if (parsed.suggested_start_feasible === false) {
                        dt = new Date(); // can't fit — prefill "now" instead of an already-past time
                      } else if (parsed.parsed_datetime) {
                        dt = new Date(parsed.parsed_datetime);
                      }
                      if (dt) {
                        // Machine-format date+time ("2026-10-25 18:00") --
                        // round-trips exactly through /parse-date's
                        // exact-ISO fast path, but is still plain text the
                        // user can edit into "tomorrow 9am" or similar.
                        const pad = (n) => String(n).padStart(2, "0");
                        setScheduleAtInput(
                          `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
                        );
                      } else {
                        setScheduleAtInput("");
                      }
                      setShowScheduleAt(true);
                    }}
                    disabled={loading}
                  >
                    {parsed.suggested_start_feasible === false
                      ? "⚡ Schedule ASAP"
                      : parsed.suggested_start_time
                        ? "⚡ Schedule at Suggested Time"
                        : parsed.parsed_datetime
                          ? "⚡ Schedule at Parsed Time"
                          : "Add & Schedule At"}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => handleAdd("now")}
                    disabled={loading}
                  >
                    {loading ? "..." : "Add & Start Now"}
                  </button>
                </div>
              )}
            </div>
          )}

          {step === STEPS.PREVIEW && parsedTasks && (
            <div className="checkin-form">
              <button
                className="edit-link"
                onClick={() => setStep(STEPS.INPUT)}
                disabled={loading}
              >
                ← edit input
              </button>

              <p className="muted" style={{ fontSize: "13px" }}>
                This looks like {parsedTasks.length} linked tasks:
              </p>

              <div className="task-preview-multi">
                {parsedTasks.map((t, i) => (
                  <div
                    key={i}
                    className="preview-row"
                    style={{
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: "2px",
                    }}
                  >
                    <span className="preview-value" style={{ fontWeight: 600 }}>
                      {i + 1}. {t.title}
                    </span>
                    <span className="muted" style={{ fontSize: "12px" }}>
                      {t.duration_estimated} · {t.energy_required} energy
                      {t.blocked_by?.length > 0 &&
                        ` · blocked by: ${t.blocked_by.join(", ")}`}
                    </span>
                    {(t.deadline ||
                      t.planned_date ||
                      t.suggested_schedule_date) && (
                      <span className="muted" style={{ fontSize: "12px" }}>
                        {t.deadline && `Due ${formatDeadline(t.deadline)}`}
                        {t.deadline &&
                          (t.planned_date || t.suggested_schedule_date) &&
                          " · "}
                        {(t.planned_date || t.suggested_schedule_date) &&
                          `Planned ${formatDateOnly(t.planned_date || t.suggested_schedule_date)}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {error && (
                <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
              )}

              <button
                className="btn-primary"
                onClick={handleAddMulti}
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? "Adding..." : `Add all ${parsedTasks.length} tasks`}
              </button>
            </div>
          )}

          {/* Step 3 — Duplicate warning */}
          {step === STEPS.DUPLICATE && (
            <div className="checkin-form">
              <p style={{ color: "var(--amber)", fontSize: "13px" }}>
                ⚠️ A task with this title already exists.
              </p>
              <div className="add-task-buttons">
                <button
                  className="btn-ghost"
                  onClick={() => setStep(STEPS.PREVIEW)}
                >
                  ← Back
                </button>
                <button
                  className="btn-danger"
                  onClick={() => handleAdd("backlog", true)}
                  disabled={loading}
                >
                  Create Anyway
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Done */}
          {step === STEPS.DONE && (
            <div style={{ textAlign: "center", padding: "24px" }}>
              <p
                style={{
                  color: "var(--green)",
                  fontSize: "15px",
                  marginBottom: "8px",
                }}
              >
                ✓ Task created
              </p>
              <p style={{ color: "var(--ink-muted)", fontSize: "13px" }}>
                {result}
              </p>
              <button
                className="btn-ghost"
                onClick={() => {
                  setText("");
                  setParsed(null);
                  setStep(STEPS.INPUT);
                  setResult("");
                }}
                style={{ marginTop: "16px" }}
              >
                Add Another
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
