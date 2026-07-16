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

function deadlineUrgency(deadline) {
  if (!deadline || deadline === "None") return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(deadline);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { label: "Overdue", color: "#8B2E2E", days };
  if (days === 0) return { label: "Due today", color: "#8B2E2E", days };
  if (days === 1) return { label: "Due tomorrow", color: "#C4832A", days };
  if (days <= 3) return { label: `Due in ${days}d`, color: "#C4832A", days };
  if (days <= 7) return { label: `Due in ${days}d`, color: "#D4A843", days };
  return { label: `Due in ${days}d`, color: "#6B6560", days };
}

function TaskCard({ task, onTouchStart, onTouchEnd }) {
  const urgency = deadlineUrgency(task.deadline);

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
      <div className="task-card-body">
        <span className="task-card-title">{task.title}</span>
        {urgency && (
          <span
            className="task-deadline-badge"
            style={{ color: urgency.color }}
          >
            {urgency.label}
          </span>
        )}
      </div>
      {task.status === "scheduled" && (
        <span className="task-scheduled-badge">●</span>
      )}
    </div>
  );
}

function sortByUrgency(tasks) {
  return [...tasks].sort((a, b) => {
    const ua = deadlineUrgency(a.deadline);
    const ub = deadlineUrgency(b.deadline);
    // No deadline goes to bottom
    if (!ua && !ub) return 0;
    if (!ua) return 1;
    if (!ub) return -1;
    return ua.days - ub.days;
  });
}

export default function TaskPool({ onRefresh }) {
  const [tasks, setTasks] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [taskMenu, setTaskMenu] = React.useState(null);
  const [filter, setFilter] = React.useState("all");
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
    setLoading(true);
    fetch(`${API}/tasks/current`)
      .then((r) => r.json())
      .then((data) => {
        const filtered = data.tasks
          .filter((t) => t.status !== "done")
          .map((t) => ({
            ...t,
            planned_date: t.planned_date === "None" ? null : t.planned_date,
            deadline: t.deadline === "None" ? null : t.deadline,
            durationMinutes: parseDurationToMinutes(t.duration),
          }))
          // Hide tasks whose planned_date is in the future
          .filter((t) => {
            if (!t.planned_date) return true;
            return t.planned_date <= todayStr;
          });
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

  function refreshAll() {
    loadTasks();
    if (onRefresh) onRefresh();
  }

  async function handleTaskScheduleTime(task) {
    const time = prompt('Schedule at what time? (e.g. "9:00 AM", "14:00")');
    if (!time) return;
    setTaskMenu(null);

    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    await fetch(`${API}/schedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: task.title,
        duration_minutes: task.durationMinutes,
        preferred_start: time,
        preferred_date: date,
      }),
    });
    refreshAll();
  }

  async function handleTaskScheduleFindSlot(task) {
    setTaskMenu(null);
    const slotRes = await fetch(`${API}/find-slot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ duration_minutes: task.durationMinutes }),
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
          task_title: task.title,
          duration_minutes: task.durationMinutes,
          preferred_start: `${hours}:${minutes}`,
          preferred_date: date,
        }),
      });
    }
    refreshAll();
  }

  async function handleTaskScheduleNow(task) {
    setTaskMenu(null);
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");

    await fetch(`${API}/schedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_title: task.title,
        duration_minutes: task.durationMinutes,
        preferred_start: `${hours}:${minutes}`,
        preferred_date: date,
      }),
    });
    refreshAll();
  }

  async function handleTaskPlan(task) {
    const date = prompt(
      `Plan for which date?\n(e.g. today, tomorrow, this thursday, ${todayStr})`,
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
    refreshAll();
  }

  async function handleTaskUnschedule(task) {
    setTaskMenu(null);
    await fetch(`${API}/unschedule-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: task.title }),
    });
    refreshAll();
  }

  async function handleTaskDelete(task) {
    if (!confirm(`Delete "${task.title}"?`)) return;
    setTaskMenu(null);

    await fetch(`${API}/delete-task`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_title: task.title }),
    });
    refreshAll();
  }

  // Apply filter
  function applyFilter(taskList) {
    switch (filter) {
      case "due_soon":
        return taskList.filter((t) => {
          const u = deadlineUrgency(t.deadline);
          return u && u.days <= 7;
        });
      case "focused":
        return taskList.filter((t) => {
          const u = deadlineUrgency(t.deadline);
          const dueSoon = u && u.days <= 3;
          const highPriority =
            t.priority === "high" || t.priority === "critical";
          const plannedToday = t.planned_date === todayStr;
          return dueSoon || highPriority || plannedToday;
        });
      default:
        return taskList;
    }
  }

  // Split and sort
  const todayPlanned = sortByUrgency(
    applyFilter(
      tasks.filter(
        (t) => t.planned_date === todayStr && t.status !== "scheduled",
      ),
    ),
  );
  const scheduled = sortByUrgency(
    applyFilter(tasks.filter((t) => t.status === "scheduled")),
  );
  const unscheduled = sortByUrgency(
    applyFilter(
      tasks.filter(
        (t) => t.status !== "scheduled" && t.planned_date !== todayStr,
      ),
    ),
  );

  return (
    <div className="task-pool-inner">
      <EnergyLegend />

      {/* Filter bar */}
      <div className="task-filter-bar">
        {[
          { key: "all", label: "All" },
          { key: "due_soon", label: "Due This Week" },
          { key: "focused", label: "Focused" },
        ].map((f) => (
          <button
            key={f.key}
            className={`task-filter-btn ${filter === f.key ? "active" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="task-list" ref={containerRef}>
        {loading && <p className="muted">Loading...</p>}

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

        {!loading && unscheduled.length > 0 && (
          <>
            <div className="task-section-header">📋 Unscheduled</div>
            {unscheduled.map((task) => (
              <TaskCard
                key={task.file}
                task={task}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              />
            ))}
          </>
        )}

        {!loading &&
          todayPlanned.length === 0 &&
          scheduled.length === 0 &&
          unscheduled.length === 0 && (
            <p className="muted">No tasks match this filter.</p>
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
            <div className="context-section-label">Schedule</div>
            <button onClick={() => handleTaskScheduleTime(taskMenu.task)}>
              📅 Enter time
            </button>
            <button onClick={() => handleTaskScheduleFindSlot(taskMenu.task)}>
              🔍 Find next slot
            </button>
            <button onClick={() => handleTaskScheduleNow(taskMenu.task)}>
              ⚡ Start now
            </button>
            <div className="context-divider" />
            <button onClick={() => handleTaskPlan(taskMenu.task)}>
              📋 Plan for Day
            </button>
            {taskMenu.task.status === "scheduled" && (
              <button onClick={() => handleTaskUnschedule(taskMenu.task)}>
                ↩ Unschedule
              </button>
            )}
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
