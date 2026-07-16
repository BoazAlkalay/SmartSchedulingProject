import React from "react";

const API = `http://${window.location.hostname}:8000`;

export default function ContextMenu({ x, y, event, onClose, onRefresh }) {
  if (!event) return null;

  const isTask = event.extendedProps.type === "task";
  const title = event.title;

  async function handleComplete() {
    await fetch(`${API}/complete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title }),
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

  async function handleRetry() {
    const time = prompt(
      'Retry at what time? (e.g. "9pm today", "tomorrow 9am")',
    );
    if (!time) return;
    await fetch(`${API}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: title, retry_time: time }),
    });
    onClose();
    onRefresh();
  }

  return (
    <>
      {/* invisible overlay to catch outside clicks */}
      <div className="context-overlay" onClick={onClose} />

      <div className="context-menu" style={{ top: y, left: x }}>
        <div className="context-title">{title}</div>
        {isTask ? (
          <>
            <button onClick={handleComplete}>✓ Complete</button>
            <button onClick={handleRetry}>↩ Retry Later</button>
            <div className="context-divider" />
            <button className="danger" onClick={handleDelete}>
              ✕ Delete
            </button>
          </>
        ) : (
          <div className="context-note">Calendar event — view only</div>
        )}
      </div>
    </>
  );
}
