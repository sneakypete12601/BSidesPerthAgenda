// =============================================================================
// ADMIN: AUTO-SCHEDULER
// =============================================================================
// Builds a complete schedule from sessions and conference config, then saves
// it to Firestore. After saving, the real-time listener updates the UI.
// =============================================================================

import {
  saveAllScheduleDays, generateSlotId, timeToMinutes, minutesToTime
} from "../firestore.js";

import { BLOCK_PRESETS } from "./blocks.js";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run the auto-scheduler and save the result to Firestore.
 * Shows a confirmation dialog because it overwrites the existing schedule.
 *
 * @param {Firestore} db
 * @param {object} conference    - the conference config document
 * @param {Array}  sessions      - all sessions
 * @param {string} editorName
 * @returns {Promise<{warnings: string[]}>}
 */
export async function runAutoSchedule(db, conference, sessions, editorName) {
  const { scheduleMap, warnings } = buildSchedule(conference, sessions);
  await saveAllScheduleDays(db, scheduleMap, editorName);
  return { warnings };
}

// ---------------------------------------------------------------------------
// Core scheduler algorithm (pure — no Firestore calls)
// ---------------------------------------------------------------------------

/**
 * Build a complete schedule from conference config and sessions.
 * Returns { scheduleMap: Map<dayIndex, slots[]>, warnings: string[] }.
 */
export function buildSchedule(conference, sessions) {
  const days    = conference.days || [];
  const numDays = days.length;
  const buffer  = conference.defaultBufferTime || 10;
  const warnings = [];

  if (numDays === 0) return { scheduleMap: new Map(), warnings: ["No days configured."] };

  // ---- 1. Separate sessions into groups ----------------------------------
  const keynotes    = sessions.filter(s => s.isKeynote);
  const preferred   = sessions.filter(s => !s.isKeynote && s.dayPreference !== null && s.dayPreference !== undefined);
  const unpreferred = sessions.filter(s => !s.isKeynote && (s.dayPreference === null || s.dayPreference === undefined));

  // ---- 2. Initialise per-day slot arrays with opening blocks --------------
  const daySlots = days.map(() => []);

  days.forEach((day, i) => {
    // Always start with Doors Open + Registration
    daySlots[i].push(makeBlock("doors-open",   "Doors Open",    30));
    daySlots[i].push(makeBlock("registration", "Registration",  30));
  });

  // ---- 3. Place keynotes (one per day, starting from Day 0) ---------------
  keynotes.forEach((keynote, k) => {
    const targetDay = k < numDays ? k : numDays - 1;
    daySlots[targetDay].push(makeSessionSlot(keynote, buffer));
    daySlots[targetDay].push(makeBuffer(buffer));
  });

  // ---- 4. Assign day-preferred sessions -----------------------------------
  // Group by day preference
  const prefGroups = new Map(); // dayIndex → sessions[]
  preferred.forEach(s => {
    const idx = parseInt(s.dayPreference, 10);
    if (!prefGroups.has(idx)) prefGroups.set(idx, []);
    prefGroups.get(idx).push(s);
  });

  // Sort each group by duration descending (longer talks first)
  prefGroups.forEach(group => group.sort((a, b) => b.durationMinutes - a.durationMinutes));

  // We'll collect preferred sessions that couldn't be placed (overflow)
  const overflowFromPreferred = [];

  prefGroups.forEach((group, dayIdx) => {
    if (dayIdx >= numDays) {
      overflowFromPreferred.push(...group);
      return;
    }
    group.forEach(s => {
      daySlots[dayIdx].push(makeSessionSlot(s, buffer));
      daySlots[dayIdx].push(makeBuffer(buffer));
    });
  });

  // ---- 5. Round-robin distribute remaining sessions -----------------------
  // Merge overflow + unpreferred, sort by duration desc
  const toDistribute = [
    ...overflowFromPreferred,
    ...unpreferred.sort((a, b) => b.durationMinutes - a.durationMinutes)
  ];

  // Build a simple count of how many talks are on each day so we can
  // balance across days.
  const talkCount = daySlots.map(slots =>
    slots.filter(s => s.type === "session").length
  );

  toDistribute.forEach(session => {
    // Pick the day with the fewest talks (prefer lower index on tie)
    let minCount = Infinity;
    let targetDay = 0;
    talkCount.forEach((count, i) => {
      if (count < minCount) { minCount = count; targetDay = i; }
    });
    daySlots[targetDay].push(makeSessionSlot(session, buffer));
    daySlots[targetDay].push(makeBuffer(buffer));
    talkCount[targetDay]++;
  });

  // ---- 6. Insert breaks at logical positions per day ----------------------
  days.forEach((day, i) => {
    daySlots[i] = insertBreaks(daySlots[i], day.startTime || "09:00");
  });

  // ---- 7. Remove trailing buffer slot from each day -----------------------
  days.forEach((_, i) => {
    const slots = daySlots[i];
    while (slots.length && slots[slots.length - 1].type === "buffer") {
      slots.pop();
    }
  });

  // ---- 8. Capacity check --------------------------------------------------
  days.forEach((day, i) => {
    const available = timeToMinutes(day.endTime || "18:00") - timeToMinutes(day.startTime || "09:00");
    const used      = daySlots[i].reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    if (used > available) {
      const over = used - available;
      warnings.push(
        `Day ${i + 1} (${day.date || ""}): schedule is ${over} minutes over capacity. ` +
        `Consider removing sessions or extending the end time.`
      );
    }
  });

  // ---- 9. Build the result Map --------------------------------------------
  const scheduleMap = new Map();
  days.forEach((_, i) => {
    scheduleMap.set(i, daySlots[i]);
  });

  return { scheduleMap, warnings };
}

// ---------------------------------------------------------------------------
// Break insertion
// ---------------------------------------------------------------------------

/**
 * Walk through a day's slots and insert Morning Break, Lunch, Afternoon Break
 * at appropriate times. Times are computed cumulatively from dayStartTime.
 *
 * Strategy:
 *   - Morning break: insert after the first session that ends around 10:30–11:00
 *   - Lunch:         insert after the first session that ends at/after 12:00
 *   - Afternoon break: insert after the first session that ends at/after 15:00
 */
function insertBreaks(slots, dayStartTimeStr) {
  const dayStartMin = timeToMinutes(dayStartTimeStr);
  let elapsed = 0;

  let morningBreakInserted = false;
  let lunchInserted        = false;
  let afternoonBreakInserted = false;

  const result = [];

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    result.push(slot);
    elapsed += slot.durationMinutes || 0;

    const wallTime = dayStartMin + elapsed; // minutes from midnight

    // Insert Morning Break ~10:30 (630 min)
    if (!morningBreakInserted && wallTime >= 630 && slot.type === "session") {
      // Only insert if the next slot isn't already a break/block
      const next = slots[i + 1];
      if (!next || next.type === "session" || next.type === "buffer") {
        result.push(makeBlock("morning-break", "Morning Break", 20));
        elapsed += 20;
        morningBreakInserted = true;
      }
    }

    // Insert Lunch ~12:00 (720 min)
    if (!lunchInserted && wallTime >= 720 && slot.type === "session") {
      const next = slots[i + 1];
      if (!next || next.type === "session" || next.type === "buffer") {
        result.push(makeBlock("lunch", "Lunch Break", 60));
        elapsed += 60;
        lunchInserted = true;
      }
    }

    // Insert Afternoon Break ~15:00 (900 min)
    if (!afternoonBreakInserted && wallTime >= 900 && slot.type === "session") {
      const next = slots[i + 1];
      if (!next || next.type === "session" || next.type === "buffer") {
        result.push(makeBlock("afternoon-break", "Afternoon Break", 20));
        elapsed += 20;
        afternoonBreakInserted = true;
      }
    }
  }

  // If we never reached the threshold times (e.g. short conference day),
  // still insert a lunch at the midpoint of sessions if we have any sessions
  if (!lunchInserted) {
    const sessionSlots = result.filter(s => s.type === "session");
    if (sessionSlots.length >= 2) {
      // Find a good midpoint to insert lunch
      const midIdx = Math.ceil(sessionSlots.length / 2);
      let sessionCount = 0;
      let insertAfter = -1;
      for (let i = 0; i < result.length; i++) {
        if (result[i].type === "session") {
          sessionCount++;
          if (sessionCount === midIdx) { insertAfter = i; break; }
        }
      }
      if (insertAfter >= 0) {
        result.splice(insertAfter + 1, 0, makeBlock("lunch", "Lunch Break", 60));
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Slot factory helpers
// ---------------------------------------------------------------------------

function makeSessionSlot(session, _buffer) {
  return {
    slotId:          generateSlotId(),
    type:            "session",
    blockType:       null,
    label:           null,
    durationMinutes: session.durationMinutes || 45,
    sessionId:       session.id
  };
}

function makeBuffer(minutes) {
  return {
    slotId:          generateSlotId(),
    type:            "buffer",
    blockType:       null,
    label:           "Break",
    durationMinutes: minutes,
    sessionId:       null
  };
}

function makeBlock(blockType, label, duration) {
  return {
    slotId:          generateSlotId(),
    type:            "block",
    blockType,
    label,
    durationMinutes: duration,
    sessionId:       null,
    location:        ""
  };
}

// ---------------------------------------------------------------------------
// Render day columns in the admin schedule grid
// ---------------------------------------------------------------------------

import {
  computeStartTimes, formatTime, formatDate, formatDateShort,
  saveScheduleDay
} from "../firestore.js";

import { renderAddBlockPanel, attachBlockPanelListeners, openBlockModal, removeBlock } from "./blocks.js";

let _db_render = null;
let _conf_render = null;
let _sessions_render = new Map();
let _schedule_render = new Map();
let _editorName_render = null;
let _locked_render = false;

export function initScheduleGrid(db, editorName) {
  _db_render = db;
  _editorName_render = editorName;
}

export function renderScheduleGrid(conference, sessionsMap, scheduleMap, locked) {
  _conf_render     = conference;
  _sessions_render = sessionsMap;
  _schedule_render = scheduleMap;
  _locked_render   = locked;

  const container = document.getElementById("days-container");
  if (!conference || !conference.days) { container.innerHTML = ""; return; }

  container.innerHTML = conference.days.map((day, i) =>
    renderDayColumn(day, i, scheduleMap.get(i))
  ).join("");

  // Attach event listeners
  conference.days.forEach((_, i) => {
    attachBlockPanelListeners(container);
    attachSlotListeners(container, i);
  });
}

function renderDayColumn(day, dayIndex, dayData) {
  const slots = dayData?.slots || [];
  const slotsWithTimes = computeStartTimes(day.startTime || "09:00", slots);

  // Capacity bar calculation
  const availMin = timeToMinutes(day.endTime || "18:00") - timeToMinutes(day.startTime || "09:00");
  const usedMin  = slots.reduce((s, sl) => s + (sl.durationMinutes || 0), 0);
  const fillPct  = Math.min(100, Math.round((usedMin / availMin) * 100));
  const overCap  = usedMin > availMin;

  return `
  <div class="day-column" data-day="${dayIndex}">
    <div class="day-column-header">
      <div>
        <h3>Day ${dayIndex + 1}</h3>
        <div class="day-date">${formatDate(day.date)}</div>
      </div>
      <div class="day-capacity">${usedMin}/${availMin} min</div>
    </div>
    <div class="capacity-bar-wrap">
      <div class="capacity-bar-track">
        <div class="capacity-bar-fill ${overCap ? "over" : ""}" style="width:${fillPct}%"></div>
      </div>
    </div>
    <div class="day-column-body">
      <div class="slot-list-admin" data-day="${dayIndex}">
        ${slots.length === 0
          ? `<div class="day-drop-zone" data-day="${dayIndex}">Drop sessions here or use Auto-Schedule</div>`
          : slotsWithTimes.map(slot => renderAdminSlot(slot, dayIndex)).join("")
        }
      </div>
      ${renderAddBlockPanel(dayIndex)}
    </div>
  </div>`;
}

function renderAdminSlot(slot, dayIndex) {
  const session = slot.type === "session" ? _sessions_render.get(slot.sessionId) : null;
  const isKeynote = session?.isKeynote;
  const confirmed = session?.confirmed !== false;

  let typeClass = `slot-type-${slot.type}`;
  if (isKeynote) typeClass += " slot-type-keynote";
  if (slot.type === "session" && !confirmed) typeClass += " tentative";

  const title = slot.type === "session"
    ? (session?.title || "Unknown session")
    : (slot.label || slot.blockType || "");

  const meta = slot.type === "session"
    ? [
        session?.speaker || "",
        `${slot.durationMinutes || session?.durationMinutes || 0} min`,
        session?.sessionType || ""
      ].filter(Boolean).join(" · ")
    : `${slot.durationMinutes || 0} min`;

  return `
  <div class="schedule-slot ${typeClass}"
       draggable="${_locked_render ? 'false' : 'true'}"
       data-slot-id="${slot.slotId}"
       data-day="${dayIndex}"
       data-type="${slot.type}">
    <div class="slot-inner">
      <div class="slot-drag-handle" title="Drag to reorder">⠿</div>
      <div class="slot-start-time">${formatTime(slot.startTime)}</div>
      <div class="slot-content">
        <div class="slot-content-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
        <div class="slot-content-meta">${escapeHtml(meta)}</div>
      </div>
      <div class="slot-actions">
        ${slot.type === "block"
          ? `<button class="btn btn-sm btn-secondary edit-block-btn"
                     data-day="${dayIndex}" data-slot-id="${slot.slotId}"
                     title="Edit block" ${_locked_render ? "disabled" : ""}>✏️</button>
             <button class="btn btn-sm btn-danger remove-block-btn"
                     data-day="${dayIndex}" data-slot-id="${slot.slotId}"
                     title="Remove block" ${_locked_render ? "disabled" : ""}>🗑</button>`
          : slot.type === "session"
          ? `<button class="btn btn-sm btn-danger remove-session-slot-btn"
                     data-day="${dayIndex}" data-slot-id="${slot.slotId}"
                     title="Remove from schedule" ${_locked_render ? "disabled" : ""}>✕</button>`
          : `<button class="btn btn-sm btn-danger remove-buffer-btn"
                     data-day="${dayIndex}" data-slot-id="${slot.slotId}"
                     title="Remove buffer" ${_locked_render ? "disabled" : ""}>✕</button>`
        }
      </div>
    </div>
  </div>`;
}

function attachSlotListeners(container, dayIndex) {
  // Edit block
  container.querySelectorAll(".edit-block-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const dIdx = parseInt(btn.dataset.day, 10);
      const sid  = btn.dataset.slotId;
      const dayData = _schedule_render.get(dIdx);
      if (dayData) {
        const slot = dayData.slots.find(s => s.slotId === sid);
        if (slot) openBlockModal(dIdx, slot);
      }
    });
  });

  // Remove block
  container.querySelectorAll(".remove-block-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const dIdx = parseInt(btn.dataset.day, 10);
      const sid  = btn.dataset.slotId;
      if (window.confirm("Remove this block?")) {
        removeBlock(dIdx, sid);
      }
    });
  });

  // Remove session/buffer from schedule (doesn't delete the session, just unschedules it)
  container.querySelectorAll(".remove-session-slot-btn, .remove-buffer-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const dIdx = parseInt(btn.dataset.day, 10);
      const sid  = btn.dataset.slotId;
      const dayData = _schedule_render.get(dIdx);
      if (!dayData) return;
      const slots = (dayData.slots || []).filter(s => s.slotId !== sid);
      try {
        await saveScheduleDay(_db_render, dIdx, slots, _editorName_render);
      } catch (err) {
        alert("Error: " + err.message);
      }
    });
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
