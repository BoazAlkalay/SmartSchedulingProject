import React from "react";

const API = `http://${window.location.hostname}:8000`;

function WhatNowContent({ onClose }) {
  const [loading, setLoading] = React.useState(true);
  const [response, setResponse] = React.useState("");

  React.useEffect(() => {
    fetch(`${API}/what-now`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((r) => r.json())
      .then((data) => {
        setResponse(data.response);
        setLoading(false);
      })
      .catch((err) => {
        console.error("What Now failed:", err);
        setResponse("Failed to get suggestion. Is the server running?");
        setLoading(false);
      });
  }, []);

  return (
    <div className="what-now-content">
      <div className="what-now-header">
        <span>What Now?</span>
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
      </div>
      {loading ? (
        <div className="modal-loading">
          <div className="loading-spinner" />
          <p>Thinking...</p>
        </div>
      ) : (
        <pre className="what-now-response">{response}</pre>
      )}
    </div>
  );
}

// Desktop — shows as modal with overlay
export default function WhatNowModal({ onClose }) {
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">What Now?</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <WhatNowContent onClose={onClose} />
        </div>
      </div>
    </>
  );
}

// Mobile — shows inline in actions panel
export function WhatNowInline({ onClose }) {
  return (
    <div className="what-now-inline">
      <WhatNowContent onClose={onClose} />
    </div>
  );
}
