import React, { useEffect, useRef } from "react";
import { Draggable } from "@fullcalendar/interaction";

const API = `http://${window.location.hostname}:8000`;

const ENERGY_COLORS = {
  cantrip: "#A8C5D6",
  low: "#6BAF92",
  medium: "#D4A843",
  high: "#D4732A",
  deep: "#8B2E2E",
};

function EnergyLegend() {
  return (
    <div className="energy-legend">
      {Object.entries(ENERGY_COLORS).map(([label, color]) => (
        <div key={label} className="energy-legend-item">
          <div className="task-energy-dot" style={{ background: color }} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

function TaskCard({ task, onTouchStart, onTouchEnd }) {
  return (
    <div
      className="task-card"
      data-title={task.title}
      data-energy={task.energy}
      data-duration={task.durationMinutes}
      onTouchStart={(e) => onTouchStart(e, task)}
      onTouchEnd={onTouchEnd}
      onTouchMove={onTouchEnd}
    >
      <div
        className="task-energy-dot"
        style={{ background: ENERGY_COLORS[task.energy] || "#ccc" }}
      />
      <span className="task-card-title">{task.title}</span>
      {task.status === "scheduled" && (
        <span className="task-scheduled-badge">●</span>
      )}
    </div>
  );
}

export default function TaskPool({ onTaskScheduled }) {
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [taskMenu, setTaskMenu] = React.useState(null);
  const containerRef = useRef(null);
  const longPressTimer = useRef(null);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function parseDurationToMinutes(duration) {
    if (!duration) return 60;
    let minutes = 0;
    const hrMatch = duration.match(/([\d.]+)\s*hr/);
    const minMatch = duration.match(/(\d+)\s*min/);
    if (hrMatch) minutes += parseFloat(hrMatch[1]) * 60;
    if (minMatch) minutes += parseInt(minMatch[1]);
    return minutes || 60;
  }

  function loadTasks() {
    fetch(`${API}/tasks/current`)
      .then((r) => r.json())
      .then((data) => {
        const filtered = data.tasks
          .filter((t) => t.status !== "done")
          .map((t) => ({
            ...t,
            planned_date: t.planned_date === "None" ? null : t.planned_date,
            durationMinutes: parseDurationToMinutes(t.duration),
          }));
        setTasks(filtered);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load tasks:", err);
        setLoading(false);
      });
  }

  React.useEffect(() => {
    loadTasks();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const draggable = new Draggable(containerRef.current, {
      itemSelector: ".task-card",
      eventData: (el) => {
        const title = el.getAttribute("data-title");
        return {
          title,
          duration: {
            minutes: parseInt(el.getAttribute("data-duration") || "60"),
          },
          extendedProps: {
            type: "task",
            title,
            energy: el.getAttribute("data-energy"),
          },
        };
      },
    });

    return () => draggable.destroy();
  }, [tasks]);

  function handleTouchStart(e, task) {
    longPressTimer.current = setTimeout(() => {
      const touch = e.touches[0];
      setTaskMenu({ task, x: touch.clientX, y: touch.clientY });
    }, 500);
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  async function handleTaskSchedule(task) {
    const time = prompt('Schedule at what time? (e.g. "9:00 AM", "14:00")');
    if (!time) return;
    setTaskMenu(null);

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const res = await fetch(`${API}/schedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: task.title,
        duration_minutes: task.durationMinutes,
        preferred_start: time,
        preferred_date: date,
      }),
    });
    const data = await res.json();
    if (data.status === "scheduled") {
      loadTasks();
    }
  }

  async function handleTaskPlan(task) {
    const date = prompt(
      `Plan for which date? (YYYY-MM-DD)\nToday is ${todayStr}`,
    );
    if (!date) return;
    setTaskMenu(null);

    await fetch(`${API}/plan-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: task.title,
        planned_date: date,
      }),
    });
    loadTasks();
  }

  async function handleTaskDelete(task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setTaskMenu(null);

    await fetch(`${API}/delete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: task.title }),
    });

    setTasks(tasks.filter((t) => t.title !== task.title));
  }

  // Split tasks into today's planned and everything else
  const todayPlanned = tasks.filter(
    (t) => t.planned_date === todayStr && t.status !== "scheduled",
  );
  const scheduled = tasks.filter((t) => t.status === "scheduled");
  const backlog = tasks.filter(
    (t) => t.status !== "scheduled" && t.planned_date !== todayStr,
  );

  return (
    <div className="task-pool-inner">
      <EnergyLegend />

      <div className="task-list" ref={containerRef}>
        {loading && <p className="muted">Loading...</p>}

        {/* Today's planned tasks */}
        {!loading && todayPlanned.length > 0 && (
          <>
            <div className="task-section-header">📋 Today</div>
            {todayPlanned.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              />
            ))}
          </>
        )}

        {/* Scheduled tasks */}
        {!loading && scheduled.length > 0 && (
          <>
            <div className="task-section-header">📅 Scheduled</div>
            {scheduled.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              />
            ))}
          </>
        )}

        {/* Backlog */}
        {!loading && backlog.length > 0 && (
          <>
            <div className="task-section-header">📦 Backlog</div>
            {backlog.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              />
            ))}
          </>
        )}

        {!loading && tasks.length === 0 && (
          <p className="muted">No tasks found.</p>
        )}
      </div>

      {taskMenu && (
        <>
          <div className="context-overlay" onClick={() => setTaskMenu(null)} />
          <div
            className="context-menu"
            style={{ top: taskMenu.y, left: taskMenu.x }}
          >
            <div className="context-title">{taskMenu.task.title}</div>
            <button onClick={() => handleTaskSchedule(taskMenu.task)}>
              📅 Schedule
            </button>
            <button onClick={() => handleTaskPlan(taskMenu.task)}>
              📋 Plan for Day
            </button>
            <div className="context-divider" />
            <button
              className="danger"
              onClick={() => handleTaskDelete(taskMenu.task)}
            >
              ✕ Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
