import React from "react";

const API = `http://${window.location.hostname}:8000`;

const DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function BracketRow({ bracket, onDelete, onEdit }) {
  const dayStr =
    bracket.days?.length > 0
      ? bracket.days.map((d) => d.slice(0, 2).toUpperCase()).join(" ")
      : bracket.specific_date || "one-off";

  return (
    <div className="bracket-row">
      <div
        className="bracket-row-color"
        style={{
          background: bracket.color === "green" ? "#3D6B4F" : "#8B2E2E",
        }}
      />
      <div className="bracket-row-info">
        <span className="bracket-row-name">{bracket.name}</span>
        <span className="bracket-row-meta">
          {bracket.start_time} – {bracket.end_time} · {dayStr}
          {bracket.person &&
            ` · ${bracket.color === "green" ? "available" : "unavailable"}`}
          {bracket.person && bracket.notify && " · 🔔"}
        </span>
        {bracket.description && (
          <span className="bracket-row-desc">{bracket.description}</span>
        )}
      </div>
      <div className="bracket-row-actions">
        <button className="btn-ghost" onClick={() => onEdit(bracket)}>
          Edit
        </button>
        <button className="btn-danger" onClick={() => onDelete(bracket)}>
          ✕
        </button>
      </div>
    </div>
  );
}

function BracketEditForm({ bracket, people, onSave, onCancel }) {
  const [name, setName] = React.useState(bracket.name);
  const [person, setPerson] = React.useState(bracket.person || "");
  const [notify, setNotify] = React.useState(Boolean(bracket.notify));
  const isPerson = person.trim() !== "";
  const [color, setColor] = React.useState(bracket.color);
  const [startTime, setStartTime] = React.useState(bracket.start_time);
  const [endTime, setEndTime] = React.useState(bracket.end_time);
  const [days, setDays] = React.useState(bracket.days || []);
  const [description, setDescription] = React.useState(
    bracket.description || "",
  );
  const [reflections, setReflections] = React.useState(
    bracket.reflections || "",
  );
  const [submitting, setSubmitting] = React.useState(false);

  function toggleDay(day) {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  }

  async function handleSave() {
    setSubmitting(true);
    await fetch(`${API}/brackets/${bracket.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        color,
        start_time: startTime,
        end_time: endTime,
        days,
        description,
        reflections,
        // "" turns it back into your own bracket
        person: person.trim(),
        notify: isPerson ? notify : undefined,
      }),
    });
    setSubmitting(false);
    onSave();
  }

  return (
    <div className="bracket-edit-form">
      <div className="form-field">
        <label>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="form-field">
        <label>
          Person{" "}
          <span className="optional">
            (optional — leave blank for your own bracket)
          </span>
        </label>
        <input
          type="text"
          list="bracket-edit-people-list"
          value={person}
          onChange={(e) => setPerson(e.target.value)}
        />
        <datalist id="bracket-edit-people-list">
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      <div className="form-field">
        <label>Type</label>
        <div className="bracket-type-toggle">
          <button
            className={color === "green" ? "active green" : ""}
            onClick={() => setColor("green")}
          >
            {isPerson ? "🟢 Available" : "🟢 Schedule here"}
          </button>
          <button
            className={color === "red" ? "active red" : ""}
            onClick={() => setColor("red")}
          >
            {isPerson ? "🔴 Unavailable" : "🔴 Block off"}
          </button>
        </div>
      </div>
      {isPerson && (
        <div className="form-field">
          <label>Hint when hidden</label>
          <div className="checkin-mode-toggle">
            <button
              className={notify ? "active" : ""}
              onClick={() => setNotify(true)}
            >
              🔔 On
            </button>
            <button
              className={!notify ? "active" : ""}
              onClick={() => setNotify(false)}
            >
              Off
            </button>
          </div>
        </div>
      )}
      <div className="form-field">
        <label>Time</label>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            style={{ flex: 1 }}
          />
          <span>–</span>
          <input
            type="time"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </div>
      <div className="form-field">
        <label>Days</label>
        <div className="day-selector">
          {DAY_NAMES.map((day) => (
            <button
              key={day}
              className={`day-btn ${days.includes(day) ? "active" : ""}`}
              onClick={() => toggleDay(day)}
            >
              {day.slice(0, 2).toUpperCase()}
            </button>
          ))}
        </div>
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
        <button className="btn-ghost" onClick={onCancel}>
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
  );
}

export default function BracketManager({ onClose, onSaved }) {
  const [brackets, setBrackets] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [editingBracket, setEditingBracket] = React.useState(null);

  function loadBrackets() {
    // include_people so other people's brackets can be seen, edited and
    // deleted here. (Plain /brackets leaves them out on purpose -- that's
    // what keeps them away from scheduling.)
    fetch(`${API}/brackets?include_people=true`)
      .then((r) => r.json())
      .then((data) => {
        setBrackets(data.brackets || []);
        setLoading(false);
      });
  }

  React.useEffect(() => {
    loadBrackets();
  }, []);

  async function handleDelete(bracket) {
    if (!confirm(`Delete "${bracket.name}"?`)) return;
    await fetch(`${API}/brackets/${bracket.id}`, { method: "DELETE" });
    loadBrackets();
    onSaved();
  }

  function handleEdit(bracket) {
    setEditingBracket(bracket);
  }

  function handleEditSave() {
    setEditingBracket(null);
    loadBrackets();
    onSaved();
  }

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const visibleBrackets = brackets.filter((b) => {
    if (b.specific_date && b.specific_date < todayStr) return false;
    return true;
  });

  // Your own brackets vs. other people's. People are derived from the names
  // on the brackets themselves -- there's no separate people list.
  const ownBrackets = visibleBrackets.filter((b) => !b.person);
  const greenBrackets = ownBrackets.filter((b) => b.color === "green");
  const redBrackets = ownBrackets.filter((b) => b.color === "red");
  const people = [
    ...new Set(brackets.filter((b) => b.person).map((b) => b.person)),
  ].sort((a, b) => a.localeCompare(b));
  const peopleWithVisible = people
    .map((p) => ({
      person: p,
      brackets: visibleBrackets.filter((b) => b.person === p),
    }))
    .filter((g) => g.brackets.length > 0);

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal" style={{ width: "520px" }}>
        <div className="modal-header">
          <span className="modal-title">Brackets</span>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {loading && <p className="muted">Loading...</p>}

          {editingBracket ? (
            <BracketEditForm
              bracket={editingBracket}
              people={people}
              onSave={handleEditSave}
              onCancel={() => setEditingBracket(null)}
            />
          ) : (
            <>
              {!loading && brackets.length === 0 && (
                <p className="muted">
                  No brackets yet. Draw on the calendar to create one.
                </p>
              )}

              {greenBrackets.length > 0 && (
                <div className="bracket-section">
                  <div className="bracket-section-header">🟢 Schedule Here</div>
                  {greenBrackets.map((b) => (
                    <BracketRow
                      key={b.id}
                      bracket={b}
                      onDelete={handleDelete}
                      onEdit={handleEdit}
                    />
                  ))}
                </div>
              )}

              {redBrackets.length > 0 && (
                <div className="bracket-section">
                  <div className="bracket-section-header">🔴 Blocked Off</div>
                  {redBrackets.map((b) => (
                    <BracketRow
                      key={b.id}
                      bracket={b}
                      onDelete={handleDelete}
                      onEdit={handleEdit}
                    />
                  ))}
                </div>
              )}

              {peopleWithVisible.length > 0 && (
                <div className="bracket-section">
                  <div className="bracket-section-header">👥 Other People</div>
                  {peopleWithVisible.map((group) => (
                    <div key={group.person} style={{ marginBottom: "8px" }}>
                      <div
                        className="muted"
                        style={{ fontSize: "12px", fontWeight: 600 }}
                      >
                        {group.person}
                      </div>
                      {group.brackets.map((b) => (
                        <BracketRow
                          key={b.id}
                          bracket={b}
                          onDelete={handleDelete}
                          onEdit={handleEdit}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}

              <p
                className="muted"
                style={{ marginTop: "16px", fontSize: "12px" }}
              >
                💡 Draw on the calendar to create a new bracket
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
}
