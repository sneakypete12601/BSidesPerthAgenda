// =============================================================================
// ADMIN: HTML5 DRAG-AND-DROP FOR SCHEDULE SLOTS
// =============================================================================
// Enables manual reordering of slots within a day, and moving slots between
// different days. Uses the native HTML5 drag-and-drop API (no libraries).
// =============================================================================

import { saveScheduleDay } from "../firestore.js";

let _db = null;
let _schedule = new Map();  // dayIndex → dayData (kept in sync by main.js)
let _editorName = null;
let _locked = false;

// Track the drag operation
let _dragState = null;
/*
  _dragState = {
    slotId:   string,
    fromDay:  number,
    slotEl:   HTMLElement
  }
*/

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

export function initDragDrop(db, editorName) {
  _db = db;
  _editorName = editorName;
}

export function updateDragDropState(scheduleMap, locked) {
  _schedule = scheduleMap;
  _locked   = locked;
}

// ---------------------------------------------------------------------------
// Attach drag-and-drop listeners to all slot elements in the grid.
// Call this every time the schedule grid is re-rendered.
// ---------------------------------------------------------------------------

export function attachDragListeners(container) {
  // Slot elements
  container.querySelectorAll(".schedule-slot[draggable='true']").forEach(el => {
    el.addEventListener("dragstart",  onDragStart);
    el.addEventListener("dragend",    onDragEnd);
    el.addEventListener("dragover",   onDragOver);
    el.addEventListener("dragleave",  onDragLeave);
    el.addEventListener("drop",       onDrop);
  });

  // Empty drop zones
  container.querySelectorAll(".day-drop-zone").forEach(el => {
    el.addEventListener("dragover",  e => { e.preventDefault(); el.classList.add("drag-active"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-active"));
    el.addEventListener("drop",      e => onDropZone(e, el));
  });
}

// ---------------------------------------------------------------------------
// Drag start
// ---------------------------------------------------------------------------

function onDragStart(e) {
  if (_locked) { e.preventDefault(); return; }

  const el     = e.currentTarget;
  const slotId = el.dataset.slotId;
  const fromDay = parseInt(el.dataset.day, 10);

  _dragState = { slotId, fromDay, slotEl: el };

  // Store data for cross-window drops (not needed here but good practice)
  e.dataTransfer.setData("text/plain", JSON.stringify({ slotId, fromDay }));
  e.dataTransfer.effectAllowed = "move";

  // Slight delay so the drag ghost captures the element before we add the class
  requestAnimationFrame(() => el.classList.add("dragging"));
}

// ---------------------------------------------------------------------------
// Drag end — clean up all visual state
// ---------------------------------------------------------------------------

function onDragEnd() {
  if (_dragState?.slotEl) {
    _dragState.slotEl.classList.remove("dragging");
  }
  document.querySelectorAll(".drag-over-above, .drag-over-below, .drag-active")
    .forEach(el => el.classList.remove("drag-over-above", "drag-over-below", "drag-active"));
  _dragState = null;
}

// ---------------------------------------------------------------------------
// Drag over a slot — show insertion indicator
// ---------------------------------------------------------------------------

function onDragOver(e) {
  if (!_dragState) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  const target = e.currentTarget;
  if (target === _dragState.slotEl) return;

  // Remove indicator from all other slots first
  document.querySelectorAll(".drag-over-above, .drag-over-below")
    .forEach(el => {
      if (el !== target) el.classList.remove("drag-over-above", "drag-over-below");
    });

  // Determine if cursor is in the upper or lower half of the target
  const rect = target.getBoundingClientRect();
  const midY = rect.top + rect.height / 2;
  if (e.clientY < midY) {
    target.classList.add("drag-over-above");
    target.classList.remove("drag-over-below");
  } else {
    target.classList.add("drag-over-below");
    target.classList.remove("drag-over-above");
  }
}

function onDragLeave(e) {
  const target = e.currentTarget;
  // Only clear if the cursor genuinely left the element (not moving to a child)
  if (!target.contains(e.relatedTarget)) {
    target.classList.remove("drag-over-above", "drag-over-below");
  }
}

// ---------------------------------------------------------------------------
// Drop onto a slot
// ---------------------------------------------------------------------------

async function onDrop(e) {
  e.preventDefault();
  if (!_dragState) return;

  const targetEl  = e.currentTarget;
  const targetId  = targetEl.dataset.slotId;
  const toDay     = parseInt(targetEl.dataset.day, 10);
  const { slotId: fromId, fromDay } = _dragState;

  // Determine insertion position: above or below the target
  const rect = targetEl.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;

  // Clean up visual state before async operations
  onDragEnd();

  if (fromId === targetId) return; // dropped on itself

  try {
    if (fromDay === toDay) {
      await reorderWithinDay(fromDay, fromId, targetId, insertBefore);
    } else {
      await moveBetweenDays(fromDay, toDay, fromId, targetId, insertBefore);
    }
  } catch (err) {
    console.error("Drag-drop error:", err);
    alert("Error reordering: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Drop onto an empty day drop zone
// ---------------------------------------------------------------------------

async function onDropZone(e, zoneEl) {
  e.preventDefault();
  zoneEl.classList.remove("drag-active");
  if (!_dragState) return;

  const toDay   = parseInt(zoneEl.dataset.day, 10);
  const { slotId: fromId, fromDay } = _dragState;
  onDragEnd();

  if (fromDay === toDay) return;

  try {
    await moveBetweenDays(fromDay, toDay, fromId, null, false);
  } catch (err) {
    alert("Error moving slot: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Reorder within a single day
// ---------------------------------------------------------------------------

async function reorderWithinDay(dayIndex, fromId, targetId, insertBefore) {
  const dayData = _schedule.get(dayIndex);
  if (!dayData) return;

  const slots = [...(dayData.slots || [])];
  const fromIdx  = slots.findIndex(s => s.slotId === fromId);
  const targetIdx = slots.findIndex(s => s.slotId === targetId);
  if (fromIdx === -1 || targetIdx === -1) return;

  // Remove the dragged slot
  const [moved] = slots.splice(fromIdx, 1);

  // Re-find target index after removal
  const newTargetIdx = slots.findIndex(s => s.slotId === targetId);
  if (newTargetIdx === -1) { slots.push(moved); }
  else if (insertBefore) { slots.splice(newTargetIdx, 0, moved); }
  else                   { slots.splice(newTargetIdx + 1, 0, moved); }

  await saveScheduleDay(_db, dayIndex, slots, _editorName);
}

// ---------------------------------------------------------------------------
// Move a slot from one day to another
// ---------------------------------------------------------------------------

async function moveBetweenDays(fromDay, toDay, slotId, targetId, insertBefore) {
  const fromData = _schedule.get(fromDay);
  const toData   = _schedule.get(toDay);
  if (!fromData || !toData) return;

  const fromSlots = [...(fromData.slots || [])];
  const toSlots   = [...(toData.slots   || [])];

  const fromIdx = fromSlots.findIndex(s => s.slotId === slotId);
  if (fromIdx === -1) return;

  // Remove from source
  const [moved] = fromSlots.splice(fromIdx, 1);

  // Update the day reference on the slot (for display)
  // (we don't store dayIndex in slots, it's inferred from the document key)

  // Insert into target
  if (targetId === null) {
    // Dropped on empty zone — append
    toSlots.push(moved);
  } else {
    const targetIdx = toSlots.findIndex(s => s.slotId === targetId);
    if (targetIdx === -1) { toSlots.push(moved); }
    else if (insertBefore) { toSlots.splice(targetIdx, 0, moved); }
    else                   { toSlots.splice(targetIdx + 1, 0, moved); }
  }

  // Save both days (we can't batch in a single Firestore call here without
  // writeBatch, but these are two separate saves which is fine for this use case)
  await saveScheduleDay(_db, fromDay, fromSlots, _editorName);
  await saveScheduleDay(_db, toDay,   toSlots,   _editorName);
}
