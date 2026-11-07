import React from "react";

// Small dialog shown when a task is completed well after its scheduled end.
// onSubmit(extra) gets the extra /complete-task fields: {actual_duration} or
// {actual_completion_time}, or {} for "Skip" (complete exactly as before,
// leaving the duration blank rather than guessing). onCancel aborts.
export default function LateCompletionPrompt({
  title,
  scheduledEnd,
  onSubmit,
  onCancel,
}) {
  const [mode, setMode] = React.useState("duration");
  const [hours, setHours] = React.useState("");
  const [minutes, setMinutes] = React.useState("");
  const [clock, setClock] = React.useState("");

  const totalMinutes = (parseInt(hours) || 0) * 60 + (parseInt(minutes) || 0);
  const valid = mode === "duration" ? totalMinutes > 0 : !!clock;

  function save() {
    if (!valid) return;
    if (mode === "duration") {
      onSubmit({ actual_duration: `${totalMinutes}min` });
    } else {
      // The time is on the scheduled day, same as the calendar's own
      // "Completed At" action.
      const day = (scheduledEnd || "").slice(0, 10);
      onSubmit({ actual_completion_time: `${day}T${clock}` });
    }
  }

  return (
    <>
      <div className="context-overlay" onClick={onCancel} />
      <div
        className="context-menu"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: "320px",
        }}
      >
        <div className="context-title">{title}</div>
        <div className="context-form">
          <div className="context-note">
            This ran past its scheduled time. How long did it actually take?
          </div>
          <div className="context-form-buttons" style={{ marginBottom: "8px" }}>
            <button
              className={mode === "duration" ? "btn-primary" : "btn-ghost"}
              onClick={() => setMode("duration")}
            >
              Minutes worked
            </button>
            <button
              className={mode === "time" ? "btn-primary" : "btn-ghost"}
              onClick={() => setMode("time")}
            >
              Finished at
            </button>
          </div>

          {mode === "duration" ? (
            <div className="form-field">
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="number"
                  min="0"
                  placeholder="hr"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  style={{ width: "60px" }}
                  autoFocus
                />
                <input
                  type="number"
                  min="0"
                  max="59"
                  placeholder="min"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  style={{ width: "60px" }}
                />
              </div>
            </div>
          ) : (
            <div className="form-field">
              <input
                type="time"
                value={clock}
                onChange={(e) => setClock(e.target.value)}
                autoFocus
              />
            </div>
          )}

          <div className="context-form-buttons">
            <button className="btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn-ghost" onClick={() => onSubmit({})}>
              Skip
            </button>
            <button className="btn-primary" onClick={save} disabled={!valid}>
              Complete
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
