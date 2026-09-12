import React from "react";

const API = `http://${window.location.hostname}:8000`;

const isMobile = window.innerWidth <= 1024;

export default function ContextMenu({
  x,
  y,
  event,
  onClose,
  onRefresh,
  onCompleteAddNext,
}) {
  const [view, setView] = React.useState("main");
  const [progress, setProgress] = React.useState("50%");
  const [continuationNote, setContinuationNote] = React.useState("");
  const [retryTime, setRetryTime] = React.useState("");
  const [extendMinutes, setExtendMinutes] = React.useState(15);
  const [submitting, setSubmitting] = React.useState(false);
  const [remaining, setRemaining] = React.useState("");
  const [completionNote, setCompletionNote] = React.useState("");
  const [addFollowUp, setAddFollowUp] = React.useState(false);
  const [completedAtMode, setCompletedAtMode] = React.useState("time");
  const [completedAtClock, setCompletedAtClock] = React.useState("");
  const [completedAtHours, setCompletedAtHours] = React.useState("");
  const [completedAtMinutes, setCompletedAtMinutes] = React.useState("");

  const menuRef = React.useRef(null);
  const [menuStyle, setMenuStyle] = React.useState({});

  React.useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    let top = y;
    let left = x;

    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }

    setMenuStyle({ top, left });
  }, [x, y, view]);

  if (!event) return null;

  const isTask = event.extendedProps.type === "task";
  const title = event.title;

  async function handleComplete() {
    setSubmitting(true);
    await fetch(`${API}/complete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title }),
    });
    onClose();
    onRefresh();
  }

  async function handleCompletePlus() {
    setSubmitting(true);
    await fetch(`${API}/complete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title, notes: completionNote }),
    });
    onClose();
    onRefresh();
    if (addFollowUp) {
      onCompleteAddNext(`Follow-up to "${title}": `);
    }
  }

  async function handleCompletedAt() {
    setSubmitting(true);
    const body = { task_title: title };

    if (completedAtMode === "time" && completedAtClock) {
      const [hh, mm] = completedAtClock.split(":").map(Number);
      const d = event.start; // real scheduled date this event is on
      const y = d.getFullYear();
      const mo = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      body.actual_completion_time = `${y}-${mo}-${day}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    } else if (completedAtMode === "duration") {
      const totalMinutes =
        (parseInt(completedAtHours) || 0) * 60 +
        (parseInt(completedAtMinutes) || 0);
      body.actual_duration = `${totalMinutes}min`;
    }

    await fetch(`${API}/complete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    onClose();
    onRefresh();
  }

  async function handleStoppingNow() {
    setSubmitting(true);
    await fetch(`${API}/stopping-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: title,
        progress,
        remaining,
        continuation_note: continuationNote,
      }),
    });
    onClose();
    onRefresh();
  }

  async function handleRetry() {
    if (!retryTime.trim()) return;
    setSubmitting(true);
    await fetch(`${API}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: title,
        retry_time: retryTime,
      }),
    });
    onClose();
    onRefresh();
  }

  async function handleExtend() {
    setSubmitting(true);
    await fetch(`${API}/extend-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: title,
        additional_minutes: extendMinutes,
      }),
    });
    onClose();
    onRefresh();
  }

  async function handleDelete() {
    if (!confirm(`Delete "${title}"?`)) return;
    await fetch(`${API}/delete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title }),
    });
    onClose();
    onRefresh();
  }

  async function handleUnschedule() {
    setSubmitting(true);
    await fetch(`${API}/unschedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title }),
    });
    onClose();
    onRefresh();
  }

  return (
    <>
      <div className="context-overlay" onClick={onClose} />
      <div
        ref={menuRef}
        className="context-menu"
        style={{ top: menuStyle.top ?? y, left: menuStyle.left ?? x }}
      >
        <div className="context-title">{title}</div>

        {/* Main menu */}
        {view === "main" && isTask && (
          <>
            <button onClick={handleComplete}>✓ Complete</button>
            <button onClick={() => setView("completePlus")}>
              ➕ Complete & Add
            </button>
            <button onClick={() => setView("completedAt")}>
              🕐 Completed At/In
            </button>
            <button onClick={() => setView("stopping")}>⏸ Stopping Now</button>
            <button onClick={() => setView("retry")}>↩ Retry Later</button>
            <button onClick={handleUnschedule}>📋 Unschedule</button>
            {isMobile && (
              <button onClick={() => setView("extend")}>⏱ Extend</button>
            )}
            <div className="context-divider" />
            <button className="danger" onClick={handleDelete}>
              ✕ Delete
            </button>
          </>
        )}

        {view === "main" && !isTask && (
          <div className="context-note">Calendar event — view only</div>
        )}

        {/* Complete + form */}
        {view === "completePlus" && (
          <div className="context-form">
            <div className="form-field">
              <label>
                Completion note <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="anything worth remembering?"
                value={completionNote}
                onChange={(e) => setCompletionNote(e.target.value)}
              />
            </div>
            <div className="form-field checkbox-field">
              <label>
                <input
                  type="checkbox"
                  checked={addFollowUp}
                  onChange={(e) => setAddFollowUp(e.target.checked)}
                />
                Add a follow-up task
              </label>
            </div>
            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleCompletePlus}
                disabled={submitting}
              >
                {submitting ? "..." : "Complete"}
              </button>
            </div>
          </div>
        )}

        {/* Completed At/In form */}
        {view === "completedAt" && (
          <div className="context-form">
            <div className="form-field">
              <label>How do you want to record this?</label>
              <div
                className="context-form-buttons"
                style={{ marginBottom: "8px" }}
              >
                <button
                  className={
                    completedAtMode === "time" ? "btn-primary" : "btn-ghost"
                  }
                  onClick={() => setCompletedAtMode("time")}
                >
                  At a time
                </button>
                <button
                  className={
                    completedAtMode === "duration" ? "btn-primary" : "btn-ghost"
                  }
                  onClick={() => setCompletedAtMode("duration")}
                >
                  Took (duration)
                </button>
              </div>
            </div>

            {completedAtMode === "time" ? (
              <div className="form-field">
                <label>Actually finished at</label>
                <input
                  type="time"
                  value={completedAtClock}
                  onChange={(e) => setCompletedAtClock(e.target.value)}
                  autoFocus
                />
              </div>
            ) : (
              <div className="form-field">
                <label>Actual time it took</label>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="number"
                    min="0"
                    placeholder="hr"
                    value={completedAtHours}
                    onChange={(e) => setCompletedAtHours(e.target.value)}
                    style={{ width: "60px" }}
                  />
                  <input
                    type="number"
                    min="0"
                    max="59"
                    placeholder="min"
                    value={completedAtMinutes}
                    onChange={(e) => setCompletedAtMinutes(e.target.value)}
                    style={{ width: "60px" }}
                  />
                </div>
              </div>
            )}

            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleCompletedAt}
                disabled={
                  submitting ||
                  (completedAtMode === "time" && !completedAtClock) ||
                  (completedAtMode === "duration" &&
                    !completedAtHours &&
                    !completedAtMinutes)
                }
              >
                {submitting ? "..." : "Complete"}
              </button>
            </div>
          </div>
        )}

        {/* Stopping Now form */}
        {view === "stopping" && (
          <div className="context-form">
            <div className="form-field">
              <label>Progress</label>
              <select
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
              >
                <option value="10%">10%</option>
                <option value="25%">25%</option>
                <option value="50%">50%</option>
                <option value="75%">75%</option>
                <option value="90%">90%</option>
                <option value="Almost done">Almost done</option>
              </select>
            </div>
            <div className="form-field">
              <label>
                Time remaining <span className="optional">(optional)</span>
              </label>
              <input
                type="text"
                placeholder="e.g. 30min, 1hr"
                value={remaining}
                onChange={(e) => setRemaining(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>
                Continuation note <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={2}
                placeholder="where did you leave off?"
                value={continuationNote}
                onChange={(e) => setContinuationNote(e.target.value)}
              />
            </div>
            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleStoppingNow}
                disabled={submitting}
              >
                {submitting ? "..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {/* Retry Later form */}
        {view === "retry" && (
          <div className="context-form">
            <div className="form-field">
              <label>Retry at</label>
              <input
                type="text"
                placeholder="e.g. 3pm today, tomorrow 9am"
                value={retryTime}
                onChange={(e) => setRetryTime(e.target.value)}
                autoFocus
              />
            </div>
            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleRetry}
                disabled={submitting || !retryTime.trim()}
              >
                {submitting ? "..." : "Set"}
              </button>
            </div>
          </div>
        )}

        {/* Extend form (mobile only) */}
        {view === "extend" && (
          <div className="context-form">
            <div className="form-field">
              <label>Add minutes</label>
              <select
                value={extendMinutes}
                onChange={(e) => setExtendMinutes(parseInt(e.target.value))}
              >
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={20}>20 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
            <div className="context-form-buttons">
              <button className="btn-ghost" onClick={() => setView("main")}>
                ← Back
              </button>
              <button
                className="btn-primary"
                onClick={handleExtend}
                disabled={submitting}
              >
                {submitting ? "..." : "Extend"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
