import React from "react";

const API = `http://${window.location.hostname}:8000`;

export default function BracketPopover({ bracket, x, y, onClose, onSaved }) {
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(bracket.name);
  const [description, setDescription] = React.useState(
    bracket.description || "",
  );
  const [reflections, setReflections] = React.useState(
    bracket.reflections || "",
  );
  const [submitting, setSubmitting] = React.useState(false);

  async function handleDelete() {
    if (!confirm(`Delete "${bracket.name}" bracket?`)) return;
    await fetch(`${API}/brackets/${bracket.id}`, { method: "DELETE" });
    onSaved();
    onClose();
  }

  async function handleSave() {
    setSubmitting(true);
    await fetch(`${API}/brackets/${bracket.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, reflections }),
    });
    setSubmitting(false);
    onSaved();
    onClose();
  }

  return (
    <>
      <div className="context-overlay" onClick={onClose} />
      <div
        className="context-menu"
        style={{ top: y, left: x, minWidth: "220px" }}
      >
        <div className="context-title">
          {bracket.color === "green" ? "🟢" : "🔴"} {bracket.name}
        </div>
        <div
          style={{
            fontSize: "11px",
            color: "var(--ink-muted)",
            padding: "2px 10px 6px",
          }}
        >
          {bracket.start_time} – {bracket.end_time}
          {bracket.days?.length > 0 &&
            ` · ${bracket.days.map((d) => d.slice(0, 2).toUpperCase()).join(" ")}`}
          {bracket.specific_date && ` · ${bracket.specific_date}`}
        </div>

        {!editing ? (
          <>
            <button onClick={() => setEditing(true)}>✏️ Edit</button>
            <div className="context-divider" />
            <button className="danger" onClick={handleDelete}>
              ✕ Delete
            </button>
          </>
        ) : (
          <div
            style={{
              padding: "6px 8px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div className="form-field">
              <label>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="form-field">
              <label>Description</label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label>Reflections</label>
              <textarea
                rows={2}
                value={reflections}
                onChange={(e) => setReflections(e.target.value)}
              />
            </div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button className="btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={submitting}
                style={{ flex: 1 }}
              >
                {submitting ? "..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
