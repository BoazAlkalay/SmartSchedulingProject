import React from "react";

const API = `http://${window.location.hostname}:8000`;

const STEPS = {
  INPUT: "input",
  PREVIEW: "preview",
  DUPLICATE: "duplicate",
  DONE: "done",
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
  const [scheduleAtTime, setScheduleAtTime] = React.useState("");
  const [parsedTasks, setParsedTasks] = React.useState(null);

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

  async function handleAdd(scheduleMode) {
    setLoading(true);

    // Send the already-parsed preview data straight through instead of
    // re-sending raw text — /add-task no longer re-parses in this case,
    // so the created file is guaranteed to match exactly what the preview
    // showed (title included), closing the Add Task Re-Parse
    // Architecture Gap for the single-task path.
    const addRes = await fetch(`${API}/add-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parsed_tasks: [parsed], force: false }),
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
      await fetch(`${API}/schedule-task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_title: exactTitle,
          duration_minutes: duration,
          preferred_start: scheduleAtTime,
          preferred_date: parsed.deadline || null,
        }),
      });
      setResult(
        `Scheduled for ${scheduleAtTime}${parsed.deadline ? ` on ${parsed.deadline}` : ""}`,
      );
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
      setResult("Added to unscheduled.");
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
                  <span className="preview-value">{parsed.title}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Duration</span>
                  <span className="preview-value">
                    {parsed.duration_estimated}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Energy</span>
                  <span className="preview-value">
                    {parsed.energy_required}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Priority</span>
                  <span className="preview-value">{parsed.priority}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Due by</span>
                  <span className="preview-value">
                    {formatDeadline(parsed.deadline)}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">Planned for</span>
                  <span className="preview-value">
                    {parsed.planned_date
                      ? formatDateOnly(parsed.planned_date)
                      : parsed.suggested_schedule_date
                        ? `${formatDateOnly(parsed.suggested_schedule_date)} (suggested)`
                        : parsed.deadline
                          ? `${formatDateOnly(parsed.deadline.split("T")[0])} (same as deadline)`
                          : "not yet placed"}
                  </span>
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
                  <span className="preview-value">{parsed.folder}</span>
                </div>
                {parsed.tags?.length > 0 && (
                  <div className="preview-row">
                    <span className="preview-label">Tags</span>
                    <span className="preview-value">
                      {parsed.tags.join(", ")}
                    </span>
                  </div>
                )}
                {parsed.recurrence && (
                  <div className="preview-row">
                    <span className="preview-label">Recurrence</span>
                    <span className="preview-value">{parsed.recurrence}</span>
                  </div>
                )}
                {parsed.parsed_datetime && (
                  <div className="preview-row">
                    <span className="preview-label">Requested time</span>
                    <span
                      className="preview-value"
                      style={{ color: "var(--green)" }}
                    >
                      {formatDateTime(parsed.parsed_datetime)}
                    </span>
                  </div>
                )}
              </div>

              {error && (
                <p style={{ color: "var(--red)", fontSize: "13px" }}>{error}</p>
              )}

              {/* Schedule At inline form */}
              {showScheduleAt && (
                <div className="schedule-at-form">
                  <div className="form-field">
                    <label>When?</label>
                    <input
                      type="text"
                      placeholder="e.g. 7:35 PM, 2pm friday, tomorrow 9am"
                      value={scheduleAtTime}
                      onChange={(e) => setScheduleAtTime(e.target.value)}
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
                      disabled={loading || !scheduleAtTime.trim()}
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
                    Add to Unscheduled
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
                        const hours = String(dt.getHours()).padStart(2, "0");
                        const minutes = String(dt.getMinutes()).padStart(
                          2,
                          "0",
                        );
                        setScheduleAtTime(`${hours}:${minutes}`);
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
                  onClick={() => handleForceAdd("backlog")}
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
