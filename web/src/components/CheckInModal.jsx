import React from "react";

const API = `http://${window.location.hostname}:8000`;

export default function CheckInModal({ onClose }) {
  const [doing, setDoing] = React.useState("");
  const [energy, setEnergy] = React.useState("medium");
  const [mood, setMood] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  async function handleSubmit() {
    if (!doing.trim()) return;
    setSubmitting(true);

    await fetch(`${API}/checkin`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        doing,
        energy,
        mood,
        notes,
      }),
    });

    setSubmitting(false);
    setDone(true);
    setTimeout(() => onClose(), 1000);
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Check In</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {done ? (
            <p
              style={{
                textAlign: "center",
                color: "var(--green)",
                padding: "24px",
              }}
            >
              ✓ Logged
            </p>
          ) : (
            <div className="checkin-form">
              <div className="form-field">
                <label>What are you doing?</label>
                <input
                  type="text"
                  placeholder="e.g. working on the system"
                  value={doing}
                  onChange={(e) => setDoing(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="form-field">
                <label>Energy</label>
                <select
                  value={energy}
                  onChange={(e) => setEnergy(e.target.value)}
                >
                  <option value="cantrip">Cantrip — barely anything</option>
                  <option value="low">Low — light effort</option>
                  <option value="medium">Medium — moderate focus</option>
                  <option value="high">High — real effort</option>
                  <option value="deep">Deep — full focus</option>
                </select>
              </div>

              <div className="form-field">
                <label>
                  Mood <span className="optional">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. focused, distracted, tired"
                  value={mood}
                  onChange={(e) => setMood(e.target.value)}
                />
              </div>

              <div className="form-field">
                <label>
                  Notes <span className="optional">(optional)</span>
                </label>
                <textarea
                  placeholder="anything worth capturing"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                />
              </div>

              <button
                className="btn-primary"
                onClick={handleSubmit}
                disabled={submitting || !doing.trim()}
                style={{ width: "100%", marginTop: "8px" }}
              >
                {submitting ? "Logging..." : "Log Check In"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
