import {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
} from "react";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";

const API = `http://${window.location.hostname}:8000`;

let eventsCache = [];
let bracketsCache = [];
let ghostCache = [];
let bracketProposalCache = [];

// ── Other people's brackets ──────────────────────────────────────────────
// A bracket with a `person` is someone else's availability. They are only
// drawn for people picked in the chip row above the calendar, as narrow
// lanes down the right edge of each day so they never tint over your own
// brackets or hide behind events. They never affect scheduling -- the
// backend keeps them out of Generate Schedule / Suggest Brackets.
const PEOPLE_STORAGE_KEY = "smartscheduler.selectedPeople";
const PERSON_LANE_WIDTH = 14; // px per selected person, per day column
// Identity colours, chosen to stay clear of the green/red/blue/purple/amber
// already used for brackets and events. Assigned by position in the sorted
// list of names.
const PERSON_COLORS = [
  "#B0457A",
  "#3F51A3",
  "#7A5230",
  "#4A5560",
  "#7C7A1E",
  "#0E7C9A",
];

let rawBracketsCache = []; // every bracket as last fetched, people's included
let knownPeople = []; // sorted names found on brackets
let selectedPeopleSet = loadSelectedPeople();

function loadSelectedPeople() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PEOPLE_STORAGE_KEY)) || []);
  } catch {
    return new Set();
  }
}

function saveSelectedPeople() {
  try {
    localStorage.setItem(
      PEOPLE_STORAGE_KEY,
      JSON.stringify([...selectedPeopleSet]),
    );
  } catch {
    // remembering the selection is a nicety -- fine without it
  }
}

// Whether the name chips are folded away behind the 👥 button. Remembered
// like the selection, since it's a how-I-like-my-screen choice.
const PEOPLE_COLLAPSED_KEY = "smartscheduler.peopleChipsCollapsed";

function loadChipsCollapsed() {
  try {
    return localStorage.getItem(PEOPLE_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveChipsCollapsed(collapsed) {
  try {
    localStorage.setItem(PEOPLE_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // a nicety -- fine without it
  }
}

// A fingerprint of everything about other people's brackets that the
// chips, day badges and 👥 ring are drawn from. Compared after each fetch
// so those re-render when a bracket changes, and only then.
function peopleDataKey(brackets) {
  return brackets
    .filter((b) => b.person)
    .map((b) =>
      [
        b.id,
        b.person,
        b.color,
        b.notify,
        (b.days || []).join("+"),
        b.specific_date,
        b.start_time,
        b.end_time,
        b.name,
      ].join("~"),
    )
    .join("|");
}

function peopleFrom(brackets) {
  return [
    ...new Set(brackets.filter((b) => b.person).map((b) => b.person)),
  ].sort((a, b) => a.localeCompare(b));
}

function personColor(person) {
  const i = Math.max(0, knownPeople.indexOf(person));
  return PERSON_COLORS[i % PERSON_COLORS.length];
}

// People who are both selected and still exist, in chip order. A person's
// position here is their lane (0 = far right of the day column).
function shownPeople() {
  return knownPeople.filter((p) => selectedPeopleSet.has(p));
}

// ── Day reveal ───────────────────────────────────────────────────────────
// People who are NOT selected can still be peeked at one day at a time: a
// day whose hidden people have a "notify" bracket gets a badge, and tapping
// it reveals every hidden person's brackets for just that day. This map is
// date ("YYYY-MM-DD") -> Set of names revealed on that date. It is
// deliberately temporary: kept in memory only, so it resets on reload,
// unlike the chip selection.
const revealedByDate = new Map();

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Every other-person bracket that applies on a given date.
function personBracketsOn(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayName = DAY_NAMES[new Date(y, m - 1, d).getDay()];
  return rawBracketsCache.filter(
    (b) =>
      b.person && (b.days?.includes(dayName) || b.specific_date === dateStr),
  );
}

// Unselected people currently revealed on a date (and who still exist).
function revealedPeopleOn(dateStr) {
  const set = revealedByDate.get(dateStr);
  if (!set) return [];
  return knownPeople.filter((p) => set.has(p) && !selectedPeopleSet.has(p));
}

// People to flag on a date: not selected, not already revealed that day,
// and with at least one bracket that day whose notify toggle is on.
function flaggedPeopleOn(dateStr) {
  const revealed = revealedByDate.get(dateStr);
  const names = new Set(
    personBracketsOn(dateStr)
      .filter(
        (b) =>
          b.notify &&
          !selectedPeopleSet.has(b.person) &&
          !(revealed && revealed.has(b.person)),
      )
      .map((b) => b.person),
  );
  return knownPeople.filter((p) => names.has(p));
}

// Ref callback for buttons that live inside the calendar's own cells. The
// calendar watches pointer-downs on its cells to start a selection (which
// opens New Bracket) or a date click, and it sees them before React does --
// so the press has to be stopped on the element itself, natively.
function keepPressFromCalendar(el) {
  if (!el) return;
  for (const type of ["mousedown", "touchstart", "pointerdown"]) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }
}

// Lane order for one day: selected people first (same lanes on every day),
// then anyone revealed just for that day.
function lanesOn(dateStr) {
  return [...shownPeople(), ...revealedPeopleOn(dateStr)];
}

async function fetchBrackets(dateRange) {
  // include_people: plain /brackets leaves other people's brackets out on
  // purpose (that is what keeps them away from scheduling), so the calendar
  // has to ask for them.
  const res = await fetch(`${API}/brackets?include_people=true`);
  const data = await res.json();
  rawBracketsCache = data.brackets || [];
  knownPeople = peopleFrom(rawBracketsCache);
  return bracketsToFCEvents(rawBracketsCache, dateRange);
}

// Build calendar events for brackets across a date range. Other people's
// brackets are only included for people who are currently selected, or who
// have been revealed for that particular day.
function bracketsToFCEvents(brackets, dateRange) {
  const dayNames = DAY_NAMES;
  const events = [];

  // Generate dates in the current view range
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayName = dayNames[d.getDay()];

    for (const bracket of brackets) {
      const revealedOnly =
        bracket.person &&
        !selectedPeopleSet.has(bracket.person) &&
        revealedByDate.get(dateStr)?.has(bracket.person);
      if (
        bracket.person &&
        !selectedPeopleSet.has(bracket.person) &&
        !revealedOnly
      )
        continue;

      const matchesDay = bracket.days?.includes(dayName);
      const matchesDate = bracket.specific_date === dateStr;

      if ((matchesDay || matchesDate) && bracket.person) {
        events.push({
          id: `bracket_${bracket.id}_${dateStr}`,
          title: bracket.name,
          start: `${dateStr}T${bracket.start_time}:00`,
          end: `${dateStr}T${bracket.end_time}:00`,
          display: "background",
          backgroundColor:
            bracket.color === "green"
              ? "rgba(61, 151, 95, 0.55)"
              : "rgba(139, 46, 46, 0.55)",
          classNames: revealedOnly
            ? ["bracket-person", "bracket-person-revealed"]
            : ["bracket-person"],
          extendedProps: {
            type: "bracket",
            bracket: bracket,
            dateStr,
            revealedOnly: Boolean(revealedOnly),
          },
        });
        continue;
      }

      if (matchesDay || matchesDate) {
        const isBasket = bracket.mode === "basket";
        events.push({
          id: `bracket_${bracket.id}_${dateStr}`,
          title: bracket.name,
          start: `${dateStr}T${bracket.start_time}:00`,
          end: `${dateStr}T${bracket.end_time}:00`,
          display: "background",
          backgroundColor: isBasket
            ? undefined
            : bracket.color === "green"
              ? "rgba(61, 151, 95, 0.25)"
              : "rgba(139, 46, 46, 0.25)",
          borderColor:
            bracket.color === "green"
              ? "rgba(61, 107, 79, 0.6)"
              : "rgba(139, 46, 46, 0.6)",
          classNames: isBasket ? ["bracket-basket"] : [],
          extendedProps: {
            type: "bracket",
            bracket: bracket,
          },
        });
      }
    }
  }

  return events;
}

function ghostBlocksToFCEvents(placements) {
  if (!placements || !Array.isArray(placements)) return [];
  return placements.map((p, i) => ({
    id: `ghost_${i}`,
    title: `✨ ${p.title}`,
    start: `${p.date}T${p.start_time}:00`,
    end: new Date(
      new Date(`${p.date}T${p.start_time}:00`).getTime() +
        p.duration_minutes * 60000,
    ).toISOString(),
    backgroundColor: "rgba(61, 107, 79, 0.3)",
    borderColor: "#3D6B4F",
    textColor: "#1C1A17",
    editable: true,
    extendedProps: {
      type: "ghost",
      placement: p,
      ghostIndex: i,
    },
  }));
}

function bracketProposalsToFCEvents(proposals) {
  if (!proposals || !Array.isArray(proposals)) return [];
  return proposals.map((p) => ({
    id: p.proposal_id,
    title: `📋 ${p.name}`,
    start: `${p.specific_date}T${p.start_time}:00`,
    end: `${p.specific_date}T${p.end_time}:00`,
    backgroundColor:
      p.color === "green"
        ? "rgba(61, 151, 95, 0.25)"
        : "rgba(139, 46, 46, 0.25)",
    borderColor: p.color === "green" ? "#3D6B4F" : "#8B2E2E",
    textColor: "#1C1A17",
    editable: true,
    extendedProps: {
      type: "bracket_proposal",
      proposal: p,
    },
  }));
}

async function fetchEvents(dateRange) {
  let url = `${API}/whats-coming?scope=full_two_days`;
  if (dateRange) {
    // Use the calendar's actual visible range (same source fetchBrackets
    // already uses) so Week/Month views see real data across every day
    // shown, not just today/tomorrow.
    const start = new Date(dateRange.start);
    const end = new Date(dateRange.end);
    const toDateStr = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    url = `${API}/whats-coming?start=${toDateStr(start)}&end=${toDateStr(end)}`;
  }
  const res = await fetch(url);
  const data = await res.json();
  const items = data.items || [];

  const taskTitles = new Set(
    items.filter((i) => i.type === "task").map((i) => i.title.toLowerCase()),
  );

  const filtered = items.filter((i) => {
    if (i.type === "calendar" && taskTitles.has(i.title.toLowerCase())) {
      return false;
    }
    return true;
  });

  eventsCache = filtered.map(itemToFCEvent);
  return eventsCache;
}

function itemToFCEvent(item) {
  if (item.type === "calendar") {
    const isCompleted = !!item.completed;
    return {
      id: item.title + item.start,
      title: isCompleted ? `✓ ${item.title}` : item.title,
      start: item.date + "T" + to24hr(item.start),
      end: item.date + "T" + to24hr(item.end),
      backgroundColor: isCompleted ? "#6B7A6F" : "#3D6B4F",
      borderColor: isCompleted ? "#6B7A6F" : "#3D6B4F",
      textColor: isCompleted ? "#E8E8E0" : "white",
      classNames: isCompleted ? ["completed-event"] : [],
      editable: false,
      extendedProps: {
        type: "calendar",
        calendar: item.calendar,
        completed: isCompleted,
      },
    };
  } else {
    let endTime = null;
    if (item.end) {
      endTime = item.date + "T" + to24hr(item.end);
    } else if (item.duration) {
      let mins = 0;
      const hrMatch = item.duration.match(/([\d.]+)\s*hr/);
      const minMatch = item.duration.match(/(\d+)\s*min/);
      if (hrMatch) mins += parseFloat(hrMatch[1]) * 60;
      if (minMatch) mins += parseInt(minMatch[1]);
      if (mins > 0) {
        const startMs = new Date(
          item.date + "T" + to24hr(item.start),
        ).getTime();
        const endMs = startMs + mins * 60000;
        const endDate = new Date(endMs);
        endTime = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}T${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}:00`;
      }
    }

    return {
      id: item.title + item.start,
      title: item.title,
      start: item.date + "T" + to24hr(item.start),
      end: endTime,
      backgroundColor:
        item.status === "in-progress"
          ? "#7B5EA7"
          : item.overdue
            ? "#C4832A"
            : "#5A8FA6",
      borderColor:
        item.status === "in-progress"
          ? "#7B5EA7"
          : item.overdue
            ? "#C4832A"
            : "#5A8FA6",
      textColor: "white",
      editable: true,
      extendedProps: {
        type: "task",
        energy: item.energy,
        duration: item.duration,
        title: item.title,
        status: item.status,
      },
    };
  }
}

function to24hr(timeStr) {
  if (!timeStr) return "00:00:00";
  const [time, meridiem] = timeStr.split(" ");
  let [h, m] = time.split(":").map(Number);
  if (meridiem === "PM" && h !== 12) h += 12;
  if (meridiem === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function parseDurationString(duration) {
  if (!duration) return 60;
  let mins = 0;
  const hrMatch = duration.match(/([\d.]+)\s*hr/);
  const minMatch = duration.match(/(\d+)\s*min/);
  if (hrMatch) mins += parseFloat(hrMatch[1]) * 60;
  if (minMatch) mins += parseInt(minMatch[1]);
  return mins || 60;
}

const CalendarGrid = forwardRef(function CalendarGrid(
  {
    view,
    onContextMenu,
    onDateClick,
    onDateChange,
    onBracketCreate,
    onGhostReject,
    onGhostMove,
    onBracketProposalEdit,
    onBracketProposalReject,
    onBracketProposalMove,
    onBracketProposalResize,
    onBasketOpen,
  },
  ref,
) {
  const calendarRef = useRef(null);
  const [currentDateLabel, setCurrentDateLabel] = useState("");
  const [showColorKey, setShowColorKey] = useState(false);
  const ghostBlocksRef = useRef([]);
  const bracketProposalsRef = useRef([]);

  // Other people's brackets: who exists, and who is switched on. The module
  // level copies (knownPeople / selectedPeopleSet) are what the event
  // builder reads; this state is what the chip row renders from.
  const [people, setPeople] = useState([]);
  const [selectedPeople, setSelectedPeople] = useState(() => [
    ...selectedPeopleSet,
  ]);
  const shown = people.filter((p) => selectedPeople.includes(p));
  const [chipsCollapsed, setChipsCollapsed] = useState(loadChipsCollapsed);
  // Changes whenever other people's bracket data changes -- its only job is
  // to trigger a re-render then (see peopleDataKey).
  const [, setPeopleKey] = useState("");

  function toggleChips() {
    const next = !chipsCollapsed;
    saveChipsCollapsed(next);
    setChipsCollapsed(next);
  }

  // Day reveal. revealedByDate (module level) holds the data; this counter
  // only exists to re-render the day headers and gutter when it changes.
  const [, setRevealVersion] = useState(0);
  // Dates currently on screen, so the gutter is sized for what's visible.
  const [visibleRange, setVisibleRange] = useState(null);
  // Month view can't draw lanes, so its badge opens a list instead.
  const [dayPeoplePopover, setDayPeoplePopover] = useState(null);

  // Widest any visible day needs: selected people plus that day's reveals.
  let extraLanes = 0;
  if (visibleRange) {
    for (const [dateStr] of revealedByDate) {
      if (dateStr >= visibleRange.start && dateStr < visibleRange.end) {
        extraLanes = Math.max(extraLanes, revealedPeopleOn(dateStr).length);
      }
    }
  }

  // Does anyone at all have a bracket on a day that's currently on screen?
  // Drives the ring on the 👥 button.
  let peopleInView = false;
  if (visibleRange) {
    const [y, m, d] = visibleRange.start.split("-").map(Number);
    for (
      let day = new Date(y, m - 1, d);
      toDateStr(day) < visibleRange.end;
      day.setDate(day.getDate() + 1)
    ) {
      if (personBracketsOn(toDateStr(day)).length > 0) {
        peopleInView = true;
        break;
      }
    }
  }

  function togglePerson(person) {
    if (selectedPeopleSet.has(person)) selectedPeopleSet.delete(person);
    else selectedPeopleSet.add(person);
    saveSelectedPeople();
    setSelectedPeople([...selectedPeopleSet]);
    redrawPeople();
  }

  // Reveal every hidden person who has a bracket on this day (notify on or
  // off -- once you ask to look, you see everything for that day).
  function revealDay(dateStr) {
    const names = personBracketsOn(dateStr)
      .map((b) => b.person)
      .filter((p) => !selectedPeopleSet.has(p));
    revealedByDate.set(dateStr, new Set(names));
    setRevealVersion((v) => v + 1);
    redrawPeople();
  }

  // Hide one revealed person again, for that day only.
  function hideRevealed(dateStr, person) {
    const set = revealedByDate.get(dateStr);
    if (!set) return;
    set.delete(person);
    if (set.size === 0) revealedByDate.delete(dateStr);
    setRevealVersion((v) => v + 1);
    redrawPeople();
  }

  function redrawPeople() {
    // Redraw from what's already loaded -- no network. Every person lane is
    // rebuilt (not just the one that changed) because lanes close up when
    // someone is switched off.
    const api = calendarRef.current?.getApi();
    if (!api) return;
    const range = { start: api.view.activeStart, end: api.view.activeEnd };
    api
      .getEvents()
      .filter((e) => e.extendedProps?.bracket?.person)
      .forEach((e) => e.remove());
    bracketsToFCEvents(
      rawBracketsCache.filter((b) => b.person),
      range,
    ).forEach((e) => api.addEvent(e, true));
    bracketsCache = bracketsToFCEvents(rawBracketsCache, range);
  }

  useImperativeHandle(ref, () => ({
    refresh() {
      console.log("refresh called, clearing cache");
      eventsCache = [];
      bracketsCache = [];

      calendarRef.current?.getApi().refetchEvents();
    },
    gotoDate(date) {
      calendarRef.current?.getApi().gotoDate(date);
    },
    changeView(viewName) {
      calendarRef.current?.getApi().changeView(viewName);
    },
    getCurrentDate() {
      return calendarRef.current?.getApi().getDate();
    },
    prev() {
      calendarRef.current?.getApi().prev();
    },
    next() {
      calendarRef.current?.getApi().next();
    },
    today() {
      calendarRef.current?.getApi().today();
    },
    unselect() {
      calendarRef.current?.getApi().unselect();
    },
    setGhostBlocks(placements) {
      ghostCache = placements;
      ghostBlocksRef.current = placements;
      eventsCache = [];
      bracketsCache = [];
      const api = calendarRef.current?.getApi();
      if (!api) return;
      api.refetchEvents();
      setTimeout(() => {
        ghostBlocksToFCEvents(placements).forEach((e) => api.addEvent(e));
      }, 300);
    },
    updateGhostBlocks(placements) {
      ghostCache = placements;
      ghostBlocksRef.current = placements;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      const toRemove = [];
      api.getEvents().forEach((e) => {
        if (e.id.startsWith("ghost_")) toRemove.push(e);
      });
      toRemove.forEach((e) => e.remove());
      ghostBlocksToFCEvents(placements).forEach((e) => api.addEvent(e));
    },
    clearGhostBlocks() {
      ghostCache = [];
      ghostBlocksRef.current = [];
      eventsCache = [];
      bracketsCache = [];
      const api = calendarRef.current?.getApi();
      if (!api) return;
      // Remove ghost events immediately before refetch
      const toRemove = [];
      api.getEvents().forEach((e) => {
        if (e.id.startsWith("ghost_")) toRemove.push(e);
      });
      toRemove.forEach((e) => e.remove());
      api.refetchEvents();
    },
    setBracketProposals(proposals) {
      bracketProposalCache = proposals;
      bracketProposalsRef.current = proposals;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      bracketProposalsToFCEvents(proposals).forEach((e) => api.addEvent(e));
    },
    removeBracketProposal(proposalId) {
      bracketProposalCache = bracketProposalCache.filter(
        (p) => p.proposal_id !== proposalId,
      );
      bracketProposalsRef.current = bracketProposalCache;
      const api = calendarRef.current?.getApi();
      if (!api) return;
      const event = api.getEventById(proposalId);
      if (event) event.remove();
    },
    clearBracketProposals() {
      bracketProposalCache = [];
      bracketProposalsRef.current = [];
      const api = calendarRef.current?.getApi();
      if (!api) return;
      const toRemove = [];
      api.getEvents().forEach((e) => {
        if (e.id.startsWith("proposal_")) toRemove.push(e);
      });
      toRemove.forEach((e) => e.remove());
    },
  }));

  useEffect(() => {
    if (!calendarRef.current) return;
    const api = calendarRef.current.getApi();
    if (api) {
      const viewMap = {
        Day: "timeGridDay",
        "3 Day": "timeGridThreeDay",
        Week: "timeGridWeek",
        Month: "dayGridMonth",
      };
      api.changeView(viewMap[view] || "timeGridDay");
    }
  }, [view]);

  return (
    <div
      className="calendar-grid"
      style={{
        "--people-gutter": `${(shown.length + extraLanes) * PERSON_LANE_WIDTH}px`,
      }}
    >
      {/* ── Date label + color key ── */}
      <div className="calendar-header-row">
        {currentDateLabel && (
          <div className="calendar-date-label">{currentDateLabel}</div>
        )}
        <div className="color-key-wrapper">
          <button
            className="color-key-btn"
            onClick={() => setShowColorKey(!showColorKey)}
          >
            ?
          </button>
          {showColorKey && (
            <>
              <div
                className="context-overlay"
                onClick={() => setShowColorKey(false)}
              />
              <div className="color-key-popover">
                <div className="color-key-title">Calendar Legend</div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#3D6B4F" }}
                  />
                  <span>Google Calendar event</span>
                </div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#5A8FA6" }}
                  />
                  <span>Scheduled task</span>
                </div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#7B5EA7" }}
                  />
                  <span>In progress (paused)</span>
                </div>
                <div className="color-key-item">
                  <div
                    className="color-key-dot"
                    style={{ background: "#C4832A" }}
                  />
                  <span>Overdue task</span>
                </div>
                {people.length > 0 && (
                  <div className="color-key-item">
                    <div
                      className="color-key-dot"
                      style={{
                        background:
                          "linear-gradient(90deg, #3D975F 50%, #8B2E2E 50%)",
                      }}
                    />
                    <span>Edge lanes: other people (green free, red busy)</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── People chips — only when someone else's brackets exist ── */}
      {people.length > 0 && (
        <div className="people-chip-row">
          {/* Press to fold the names away or bring them back. The ring
              means someone has a bracket somewhere in the days on screen,
              so you can tell there's something to look at while folded. */}
          <button
            className={`people-chip-toggle ${peopleInView ? "has-people" : ""}`}
            onClick={toggleChips}
            title={
              (chipsCollapsed ? "Show names" : "Hide names") +
              (peopleInView ? " — someone has a bracket in view" : "")
            }
          >
            👥
          </button>
          {chipsCollapsed && shown.length > 0 && (
            <span className="people-chip-summary">{shown.length} shown</span>
          )}
          {!chipsCollapsed &&
            people.map((person) => {
              const on = selectedPeople.includes(person);
              const color = personColor(person);
              return (
                <button
                  key={person}
                  className={`people-chip ${on ? "active" : ""}`}
                  style={
                    on
                      ? { background: color, borderColor: color }
                      : { borderColor: color }
                  }
                  onClick={() => togglePerson(person)}
                  title={
                    on
                      ? `Hide ${person}'s brackets`
                      : `Show ${person}'s brackets`
                  }
                >
                  {!on && (
                    <span
                      className="people-chip-dot"
                      style={{ background: color }}
                    />
                  )}
                  {person}
                </button>
              );
            })}
        </div>
      )}

      {/* ── Month view: list of other people's brackets for one day ── */}
      {dayPeoplePopover && (
        <>
          <div
            className="context-overlay"
            onClick={() => setDayPeoplePopover(null)}
          />
          <div
            className="context-menu day-people-popover"
            style={{ top: dayPeoplePopover.y, left: dayPeoplePopover.x }}
          >
            <div className="context-title">
              {new Date(
                dayPeoplePopover.dateStr + "T12:00:00",
              ).toLocaleDateString("default", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </div>
            {personBracketsOn(dayPeoplePopover.dateStr)
              .slice()
              .sort(
                (a, b) =>
                  a.person.localeCompare(b.person) ||
                  a.start_time.localeCompare(b.start_time),
              )
              .map((b) => (
                <div key={b.id} className="day-people-row">
                  <span
                    className="people-chip-dot"
                    style={{ background: personColor(b.person) }}
                  />
                  <div>
                    <div className="day-people-row-name">
                      {b.person} · {b.name}
                    </div>
                    <div className="day-people-row-meta">
                      {b.start_time}–{b.end_time} ·{" "}
                      <span
                        style={{
                          color: b.color === "green" ? "#3D6B4F" : "#8B2E2E",
                        }}
                      >
                        {b.color === "green" ? "available" : "unavailable"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </>
      )}

      {/* ── FullCalendar ── */}
      <FullCalendar
        ref={calendarRef}
        plugins={[timeGridPlugin, dayGridPlugin, interactionPlugin]}
        initialView="timeGridDay"
        views={{
          timeGridThreeDay: {
            type: "timeGrid",
            duration: { days: 3 },
            buttonText: "3 day",
          },
        }}
        headerToolbar={false}
        height="100%"
        slotMinTime="06:00:00"
        slotMaxTime="23:00:00"
        slotDuration="00:15:00"
        snapDuration="00:05:00"
        nowIndicator={true}
        editable={true}
        selectable={true}
        selectOverlap={(event) => {
          if (
            event.extendedProps?.type === "bracket" &&
            event.extendedProps?.bracket?.mode === "basket"
          ) {
            return false;
          }
          return true;
        }}
        unselectAuto={false}
        droppable={true}
        eventInteractive={true}
        dayHeaderContent={(arg) => {
          // Month headers are bare weekday names -- no date to attach to
          if (arg.view.type === "dayGridMonth") return arg.text;
          const dateStr = toDateStr(arg.date);
          const flagged = flaggedPeopleOn(dateStr);
          const revealed = revealedPeopleOn(dateStr);
          if (flagged.length === 0 && revealed.length === 0) return arg.text;
          return (
            <span className="day-header-people">
              <span>{arg.text}</span>
              {flagged.length > 0 && (
                <button
                  className="day-people-badge"
                  title={`${flagged.join(", ")} ${flagged.length === 1 ? "has" : "have"} something this day — tap to show`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    revealDay(dateStr);
                  }}
                >
                  👥 {flagged.length}
                </button>
              )}
              {revealed.map((person) => (
                <button
                  key={person}
                  className="day-people-revealed"
                  style={{ background: personColor(person) }}
                  title={`Hide ${person} for this day`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    hideRevealed(dateStr, person);
                  }}
                >
                  {person.slice(0, 1).toUpperCase()} ×
                </button>
              ))}
            </span>
          );
        }}
        dayCellContent={(arg) => {
          if (arg.view.type !== "dayGridMonth") return arg.dayNumberText;
          // Month view can't draw lanes, so flag any day where a selected
          // person, or a hidden one with notify on, has a bracket. Tapping
          // the badge lists that day's brackets.
          const dateStr = toDateStr(arg.date);
          const names = new Set(
            personBracketsOn(dateStr)
              .filter((b) => b.notify || selectedPeopleSet.has(b.person))
              .map((b) => b.person),
          );
          return (
            <>
              {names.size > 0 && (
                <button
                  ref={keepPressFromCalendar}
                  className="day-people-badge"
                  title="Other people's brackets this day"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setDayPeoplePopover({
                      dateStr,
                      x: Math.max(8, Math.min(r.left, window.innerWidth - 250)),
                      y: r.bottom + 4,
                    });
                  }}
                >
                  👥 {names.size}
                </button>
              )}
              <span>{arg.dayNumberText}</span>
            </>
          );
        }}
        datesSet={(info) => {
          // Clear cache so events refetch for new date range
          eventsCache = [];
          bracketsCache = [];

          const start = info.start;
          const viewType = info.view.type;
          setVisibleRange({
            start: toDateStr(info.start),
            end: toDateStr(info.end),
          });
          // Notify parent of current viewed date
          if (onDateChange) {
            const viewedDate = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
            onDateChange(viewedDate);
          }

          if (viewType === "dayGridMonth") {
            // info.start is the first cell in the grid, which usually falls
            // in the previous month (October's grid starts on Sep 27).
            // currentStart is the 1st of the month actually being shown.
            setCurrentDateLabel(
              info.view.currentStart.toLocaleString("default", {
                month: "long",
                year: "numeric",
              }),
            );
          } else if (viewType === "timeGridDay") {
            setCurrentDateLabel(
              start.toLocaleString("default", {
                weekday: "long",
                month: "long",
                day: "numeric",
              }),
            );
          } else if (
            viewType === "timeGridWeek" ||
            viewType === "timeGridThreeDay"
          ) {
            const end = new Date(info.end);
            end.setDate(end.getDate() - 1);
            const startStr = start.toLocaleString("default", {
              month: "long",
              day: "numeric",
            });
            const endDay = end.getDate();
            const endYear = end.getFullYear();
            setCurrentDateLabel(`${startStr} – ${endDay}, ${endYear}`);
          }
        }}
        scrollTime={(() => {
          const d = new Date(Date.now() - 5 * 60 * 1000);
          return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
        })()}
        events={async (fetchInfo, successCallback) => {
          if (eventsCache.length > 0 || bracketsCache.length > 0) {
            successCallback([...eventsCache, ...bracketsCache]);
          }
          const [fresh, brackets] = await Promise.all([
            fetchEvents(fetchInfo),
            fetchBrackets(fetchInfo),
          ]);
          bracketsCache = brackets;
          // Only touch state when the list of names really changed, so this
          // can't cause a render loop.
          setPeople((prev) =>
            prev.join("|") === knownPeople.join("|") ? prev : knownPeople,
          );
          // A string, so React skips the re-render when nothing changed.
          setPeopleKey(peopleDataKey(rawBracketsCache));
          successCallback([...fresh, ...brackets]);
        }}
        eventClick={(info) => {
          info.jsEvent.preventDefault();
          if (info.event.extendedProps.type === "bracket_proposal") {
            if (onBracketProposalEdit)
              onBracketProposalEdit(info.event.extendedProps.proposal);
          }
        }}
        eventDidMount={(info) => {
          const el = info.el;

          if (info.event.extendedProps.type === "ghost") {
            el.style.cursor = "pointer";
            el.style.overflow = "visible";

            // Hide default title
            const titleEl = el.querySelector(".fc-event-title");
            if (titleEl) titleEl.style.display = "none";

            // Floating tooltip label
            const label = document.createElement("div");
            label.className = "ghost-label";
            label.innerHTML = `✨ ${info.event.title.replace("✨ ", "")}`;
            el.appendChild(label);

            // Desktop: right-click to show reject confirmation
            el.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              e.stopPropagation();

              // Remove any existing popovers
              document
                .querySelectorAll(".ghost-confirm-popover")
                .forEach((p) => p.remove());

              // Create popover centered on the block
              const rect = el.getBoundingClientRect();
              const popover = document.createElement("div");
              popover.className = "ghost-confirm-popover";
              popover.innerHTML = `
    <div class="ghost-confirm-text">Remove this suggestion?</div>
    <div class="ghost-confirm-title">${info.event.title.replace("✨ ", "")}</div>
    <div class="ghost-confirm-buttons">
      <button class="ghost-confirm-cancel">Keep</button>
      <button class="ghost-confirm-reject">Remove</button>
    </div>
  `;

              // Position centered on the block
              popover.style.position = "fixed";
              popover.style.top = `${rect.top + rect.height / 2}px`;
              popover.style.left = `${rect.left + rect.width / 2}px`;
              popover.style.transform = "translate(-50%, -50%)";
              popover.style.zIndex = "1000";

              document.body.appendChild(popover);

              // Remove button
              popover
                .querySelector(".ghost-confirm-reject")
                .addEventListener("click", (e) => {
                  e.stopPropagation();
                  popover.remove();
                  if (onGhostReject)
                    onGhostReject(info.event.extendedProps.ghostIndex);
                });

              // Cancel button
              popover
                .querySelector(".ghost-confirm-cancel")
                .addEventListener("click", (e) => {
                  e.stopPropagation();
                  popover.remove();
                });

              // Click outside to cancel
              setTimeout(() => {
                document.addEventListener("click", function closePopover(e) {
                  if (!popover.contains(e.target)) {
                    popover.remove();
                    document.removeEventListener("click", closePopover);
                  }
                });
              }, 100);
            });

            // Mobile: tap shows label, long press to reject
            let longPressTimer = null;
            let warningTimer = null;

            el.addEventListener("touchstart", (e) => {
              label.style.opacity = "1";
              setTimeout(() => {
                label.style.opacity = "0";
              }, 2000);

              warningTimer = setTimeout(() => {
                el.style.backgroundColor = "rgba(139, 46, 46, 0.3)";
                el.style.borderColor = "#8B2E2E";
              }, 300);

              longPressTimer = setTimeout(() => {
                if (onGhostReject)
                  onGhostReject(info.event.extendedProps.ghostIndex);
              }, 600);
              el._warningTimer = warningTimer;
            });

            el.addEventListener("touchend", () => {
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
              if (el._warningTimer) {
                clearTimeout(el._warningTimer);
                el._warningTimer = null;
              }
              el.style.backgroundColor = "rgba(61, 107, 79, 0.3)";
              el.style.borderColor = "#3D6B4F";
            });

            el.addEventListener("touchmove", () => {
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
              if (el._warningTimer) {
                clearTimeout(el._warningTimer);
                el._warningTimer = null;
              }
              el.style.backgroundColor = "rgba(61, 107, 79, 0.3)";
              el.style.borderColor = "#3D6B4F";
            });

            return;
          }

          if (
            info.event.extendedProps.type === "bracket" &&
            info.event.extendedProps.bracket.person
          ) {
            // Someone else's bracket: squeeze it into that person's lane at
            // the right edge of the day column. The lanes sit in a gutter
            // that events are kept out of (see --people-gutter in App.css),
            // so they stay visible even on a busy day.
            const bracket = info.event.extendedProps.bracket;
            const { dateStr, revealedOnly } = info.event.extendedProps;
            const lane = Math.max(0, lanesOn(dateStr).indexOf(bracket.person));
            const harness = el.parentElement;
            if (harness) {
              harness.style.left = "auto";
              harness.style.right = `${lane * PERSON_LANE_WIDTH + 1}px`;
              harness.style.width = `${PERSON_LANE_WIDTH - 2}px`;
            }
            const titleEl = el.querySelector(".fc-event-title");
            if (titleEl) titleEl.style.display = "none";
            // Dashed edge = revealed for this day only, not selected
            el.style.borderLeft = `4px ${revealedOnly ? "dashed" : "solid"} ${personColor(bracket.person)}`;
            el.style.pointerEvents = "auto";
            el.title = `${bracket.person} — ${bracket.name} (${
              bracket.color === "green" ? "available" : "unavailable"
            }) ${bracket.start_time}–${bracket.end_time}`;
            return;
          }

          if (info.event.extendedProps.type === "bracket") {
            const bracket = info.event.extendedProps.bracket;

            // Move title to a small tab in the top right
            const titleEl = el.querySelector(".fc-event-title");
            if (titleEl) {
              titleEl.style.display = "none";
            }

            // Create tab element
            const tab = document.createElement("div");
            tab.className = "bracket-tab";
            tab.innerHTML = info.event.title;
            tab.style.background =
              bracket.color === "green"
                ? "rgba(61, 107, 79, 0.7)"
                : "rgba(139, 46, 46, 0.7)";
            el.appendChild(tab);

            // Force tab above other events
            el.style.overflow = "visible";
            el.style.zIndex = "999";
            if (el.parentElement) el.parentElement.style.overflow = "visible";

            // Basket brackets are tappable — open their panel.
            // Background-display events don't reliably fire FullCalendar's
            // shared eventClick, so we attach directly to the DOM element.
            if (bracket.mode === "basket") {
              el.style.pointerEvents = "auto";

              el.addEventListener("click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onBasketOpen) onBasketOpen(bracket);
              });

              el.addEventListener("touchend", (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onBasketOpen) onBasketOpen(bracket);
              });
            }

            return;
          }

          if (info.event.extendedProps.type === "bracket_proposal") {
            const proposal = info.event.extendedProps.proposal;

            // Move title to a small tab, like real brackets
            const titleEl = el.querySelector(".fc-event-title");
            if (titleEl) titleEl.style.display = "none";

            const tab = document.createElement("div");
            tab.className = "bracket-tab proposal-tab";
            tab.innerHTML = info.event.title;
            tab.style.background =
              proposal.color === "green"
                ? "rgba(61, 107, 79, 0.7)"
                : "rgba(139, 46, 46, 0.7)";
            el.appendChild(tab);

            el.style.overflow = "visible";
            el.style.zIndex = "999";
            el.style.borderStyle = "dashed";
            el.style.cursor = "pointer";
            if (el.parentElement) el.parentElement.style.overflow = "visible";

            const resetColors = () => {
              el.style.backgroundColor =
                proposal.color === "green"
                  ? "rgba(61, 151, 95, 0.25)"
                  : "rgba(139, 46, 46, 0.25)";
              el.style.borderColor =
                proposal.color === "green" ? "#3D6B4F" : "#8B2E2E";
            };

            // Desktop: right-click also opens edit modal (same entry point)
            el.addEventListener("contextmenu", (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onBracketProposalEdit) onBracketProposalEdit(proposal);
            });

            // Mobile: tap opens modal, long press (600ms) rejects, warning at 300ms
            let longPressTimer = null;
            let warningTimer = null;
            let moved = false;

            el.addEventListener("touchstart", () => {
              moved = false;
              warningTimer = setTimeout(() => {
                el.style.backgroundColor = "rgba(139, 46, 46, 0.3)";
                el.style.borderColor = "#8B2E2E";
              }, 300);

              longPressTimer = setTimeout(() => {
                if (onBracketProposalReject)
                  onBracketProposalReject(proposal.proposal_id);
                longPressTimer = null;
              }, 600);
            });

            el.addEventListener("touchmove", () => {
              moved = true;
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
              }
              if (warningTimer) {
                clearTimeout(warningTimer);
                warningTimer = null;
              }
              resetColors();
            });

            el.addEventListener("touchend", () => {
              if (warningTimer) {
                clearTimeout(warningTimer);
                warningTimer = null;
              }
              resetColors();

              // Long press hadn't fired yet -> this was a tap, open modal
              if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                if (!moved && onBracketProposalEdit)
                  onBracketProposalEdit(proposal);
              }
            });

            return;
          }

          // Hover tooltip for short tasks
          if (info.event.extendedProps.type === "task") {
            const duration = info.event.extendedProps.duration;
            if (duration) {
              const mins = parseDurationString(duration);

              if (mins <= 10) {
                // Too short for even the time range to fit — hide both
                // default parts, show title + time together in a tooltip
                el.style.overflow = "visible";
                const titleEl = el.querySelector(".fc-event-title");
                const timeEl = el.querySelector(".fc-event-time");
                const timeRangeText = timeEl ? timeEl.textContent : "";
                if (titleEl) titleEl.style.display = "none";
                if (timeEl) timeEl.style.display = "none";

                const tooltip = document.createElement("div");
                tooltip.className = "short-task-tooltip";
                tooltip.innerHTML = `${info.event.title}<br><span style="opacity:0.7;font-size:10px">${timeRangeText}</span>`;
                el.appendChild(tooltip);
              } else if (mins <= 20) {
                // Time range fits fine at this size — only the title needs help
                el.style.overflow = "visible";
                const titleEl = el.querySelector(".fc-event-title");
                if (titleEl) titleEl.style.display = "none";

                const tooltip = document.createElement("div");
                tooltip.className = "short-task-tooltip";
                tooltip.innerHTML = info.event.title;
                el.appendChild(tooltip);
              }
            }
          }

          // Desktop: right-click for regular events
          el.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            onContextMenu(e.clientX, e.clientY, info.event);
          });

          // Mobile: long press
          let longPressTimer = null;

          el.addEventListener("touchstart", (e) => {
            longPressTimer = setTimeout(() => {
              const touch = e.touches[0];
              onContextMenu(touch.clientX, touch.clientY, info.event);
            }, 500);
          });

          el.addEventListener("touchend", () => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
          });

          el.addEventListener("touchmove", () => {
            if (longPressTimer) {
              clearTimeout(longPressTimer);
              longPressTimer = null;
            }
          });
        }}
        select={(info) => {
          // A bracket needs a start and end time. Month view and the all-day
          // row only select whole days, which opened New Bracket with dates
          // where the times should be -- and in Month it did so on every
          // day click, on top of jumping to that day. Ignore those.
          if (info.allDay) {
            info.view.calendar.unselect();
            return;
          }
          if (onBracketCreate) {
            onBracketCreate({
              start: info.startStr,
              end: info.endStr,
              date: info.startStr.split("T")[0],
            });
          }
        }}
        dateClick={(info) => {
          if (info.view.type === "dayGridMonth") {
            calendarRef.current?.getApi().gotoDate(info.date);
            if (onDateClick) onDateClick(info.dateStr);
          }
        }}
        eventDrop={async (info) => {
          const { event } = info;

          // Handle ghost block drag
          if (event.extendedProps.type === "ghost") {
            const idx = event.extendedProps.ghostIndex;
            const newStart = event.start;
            const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
            const hours = String(newStart.getHours()).padStart(2, "0");
            const minutes = String(newStart.getMinutes()).padStart(2, "0");

            if (onGhostMove) onGhostMove(idx, date, `${hours}:${minutes}`);
            return;
          }

          if (event.extendedProps.type === "bracket_proposal") {
            const proposal = event.extendedProps.proposal;
            const newStart = event.start;
            const newEnd = event.end;
            const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
            const startTime = `${String(newStart.getHours()).padStart(2, "0")}:${String(newStart.getMinutes()).padStart(2, "0")}`;
            const endTime = `${String(newEnd.getHours()).padStart(2, "0")}:${String(newEnd.getMinutes()).padStart(2, "0")}`;

            if (onBracketProposalMove)
              onBracketProposalMove(
                proposal.proposal_id,
                date,
                startTime,
                endTime,
              );
            return;
          }

          if (event.extendedProps.type !== "task") {
            info.revert();
            return;
          }
          const title = event.extendedProps.title;
          const newStart = event.start;
          const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
          const hours = String(newStart.getHours()).padStart(2, "0");
          const minutes = String(newStart.getMinutes()).padStart(2, "0");
          const timeStr = `${hours}:${minutes}`;
          const duration = event.end
            ? Math.round((event.end - event.start) / 60000)
            : 60;
          try {
            const res = await fetch(`${API}/schedule-task`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_title: title,
                duration_minutes: duration,
                preferred_start: timeStr,
                preferred_date: date,
              }),
            });
            const data = await res.json();
            if (data.status !== "scheduled") {
              console.error("Schedule failed:", data);
              info.revert();
            }
          } catch (err) {
            console.error("Failed to reschedule:", err);
            info.revert();
          }
        }}
        eventResize={async (info) => {
          const { event } = info;
          if (event.extendedProps.type === "bracket_proposal") {
            const proposal = event.extendedProps.proposal;
            const newStart = event.start;
            const newEnd = event.end;
            const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
            const startTime = `${String(newStart.getHours()).padStart(2, "0")}:${String(newStart.getMinutes()).padStart(2, "0")}`;
            const endTime = `${String(newEnd.getHours()).padStart(2, "0")}:${String(newEnd.getMinutes()).padStart(2, "0")}`;

            if (onBracketProposalResize)
              onBracketProposalResize(
                proposal.proposal_id,
                date,
                startTime,
                endTime,
              );
            return;
          }
          if (event.extendedProps.type !== "task") {
            info.revert();
            return;
          }
          const title = event.extendedProps.title;
          const newStart = event.start;
          const date = `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`;
          const hours = String(newStart.getHours()).padStart(2, "0");
          const minutes = String(newStart.getMinutes()).padStart(2, "0");
          const timeStr = `${hours}:${minutes}`;
          const duration = event.end
            ? Math.round((event.end - event.start) / 60000)
            : 60;
          try {
            const res = await fetch(`${API}/schedule-task`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_title: title,
                duration_minutes: duration,
                preferred_start: timeStr,
                preferred_date: date,
              }),
            });
            const data = await res.json();
            if (data.status !== "scheduled") {
              console.error("Resize failed:", data);
              info.revert();
            }
          } catch (err) {
            console.error("Failed to resize:", err);
            info.revert();
          }
        }}
        eventReceive={async (info) => {
          const { event } = info;
          const title = event.extendedProps.title;
          const start = event.start;
          const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
          const hours = String(start.getHours()).padStart(2, "0");
          const minutes = String(start.getMinutes()).padStart(2, "0");
          const timeStr = `${hours}:${minutes}`;
          const duration = event.end
            ? Math.round((event.end - event.start) / 60000)
            : 60;

          event.remove();

          try {
            const res = await fetch(`${API}/schedule-task`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_title: title,
                duration_minutes: duration,
                preferred_start: timeStr,
                preferred_date: date,
              }),
            });
            const data = await res.json();
            if (data.status === "scheduled") {
              setTimeout(() => {
                calendarRef.current?.getApi().refetchEvents();
              }, 500);
            } else {
              console.error("Schedule failed:", data);
            }
          } catch (err) {
            console.error("Failed to schedule:", err);
          }
        }}
      />
    </div>
  );
});

export default CalendarGrid;
