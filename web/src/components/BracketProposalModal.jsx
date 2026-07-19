import React from "react";

const API = `http://${window.location.hostname}:8000`;

export default function BracketProposalModal({
  proposal,
  onClose,
  onAccept,
  onReject,
}) {
  const [name, setName] = React.useState(proposal.name);
  const [color, setColor] = React.useState(proposal.color);
  const [startTime, setStartTime] = React.useState(proposal.start_time);
  const [endTime, setEndTime] = React.useState(proposal.end_time);
  const [description, setDescription] = React.useState(
    proposal.description || "",
  );
  const [submitting, setSubmitting] = React.useState(false);

  async function handleAccept() {
    if (!name.trim()) return;
    setSubmitting(true);

    await fetch(`${API}/brackets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type: color === "green" ? "schedule" : "block",
        color,
        start_time: startTime,
        end_time: endTime,
        days: [],
        specific_date: proposal.specific_date,
        description,
        reflections: "",
      }),
    });

    setSubmitting(false);
    onAccept(proposal.proposal_id);
    onClose();
  }

  function handleReject() {
    onReject(proposal.proposal_id);
    onClose();
  }

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Review Suggested Bracket</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <div className="checkin-form">
            {proposal.reason && (
              <div className="form-field">
                <label>Why suggested</label>
                <p className="muted" style={{ fontSize: "13px", margin: 0 }}>
                  {proposal.reason}
                </p>
              </div>
            )}

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
              <label>Type</label>
              <div className="bracket-type-toggle">
                <button
                  className={color === "green" ? "active green" : ""}
                  onClick={() => setColor("green")}
                >
                  🟢 Schedule here
                </button>
                <button
                  className={color === "red" ? "active red" : ""}
                  onClick={() => setColor("red")}
                >
                  🔴 Block off
                </button>
              </div>
            </div>

            <div className="form-field">
              <label>Time</label>
              <div
                style={{ display: "flex", gap: "8px", alignItems: "center" }}
              >
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <span className="muted">–</span>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>

            <div className="form-field">
              <label>
                Description <span className="optional">(optional)</span>
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <button
                className="btn-primary"
                onClick={handleAccept}
                disabled={submitting || !name.trim()}
                style={{ flex: 1 }}
              >
                {submitting ? "Saving..." : "Accept"}
              </button>
              <button
                className="btn-danger"
                onClick={handleReject}
                disabled={submitting}
                style={{ flex: 1 }}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
