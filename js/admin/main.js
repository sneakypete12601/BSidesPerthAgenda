// =============================================================================
// ADMIN PAGE ENTRY POINT — wires all modules together
// =============================================================================
// Called from admin.html after Firebase is initialised and the PIN is verified.
// Coordinates setup, sessions, blocks, scheduler, drag-drop, collab, and export.
// =============================================================================

import { initSetup, populateSetupForm }            from "./setup.js";
import { initSessions, updateSessions, getSessions, openSessionModal } from "./sessions.js";
import { initBlocks, updateBlocksState }            from "./blocks.js";
import {
  initScheduleGrid, renderScheduleGrid,
  runAutoSchedule, buildSchedule
}                                                   from "./scheduler.js";
import { initDragDrop, updateDragDropState, attachDragListeners } from "./dragdrop.js";
import {
  promptForName, initCollab, initLockControls,
  getCurrentConference, getCurrentSessions, getCurrentSchedule
}                                                   from "./collab.js";
import { printSchedule, exportCSV }                 from "./export.js";
import { stampEdit }                                from "../firestore.js";

// ---------------------------------------------------------------------------
// Main initialisation (called from admin.html after PIN verified)
// ---------------------------------------------------------------------------

export async function initAdmin(db) {
  // ---- 1. Ask for editor name (once per browser session) ------------------
  const editorName = await promptForName();

  // ---- 2. Initialise modules that need db + editorName --------------------
  initSetup(db, editorName, onSetupComplete);
  initSessions(db, editorName, onSessionsChanged);
  initBlocks(db, editorName);
  initScheduleGrid(db, editorName);
  initDragDrop(db, editorName);

  // ---- 3. Start real-time collab watcher ----------------------------------
  initCollab(db, editorName, onDataUpdate);

  // ---- 4. Lock controls ---------------------------------------------------
  initLockControls(db, getCurrentConference);

  // ---- 5. Top-bar button wiring -------------------------------------------
  document.getElementById("export-pdf-btn").addEventListener("click", () => {
    printSchedule();
  });

  document.getElementById("export-csv-btn").addEventListener("click", () => {
    const conf      = getCurrentConference();
    const schedule  = getCurrentSchedule();
    const sessions  = new Map(getCurrentSessions().map(s => [s.id, s]));
    exportCSV(conf, schedule, sessions);
  });

  document.getElementById("auto-schedule-btn").addEventListener("click", () => {
    handleAutoSchedule(db, editorName);
  });

  document.getElementById("clear-schedule-btn").addEventListener("click", () => {
    handleClearSchedule(db, editorName);
  });

  // Warnings toggle
  document.getElementById("warnings-toggle")?.addEventListener("click", () => {
    document.getElementById("warnings-body").classList.toggle("hidden");
  });
}

// ---------------------------------------------------------------------------
// Called when collab watcher fires with updated data
// ---------------------------------------------------------------------------

function onDataUpdate({ conference, sessions, schedule }) {
  const locked = conference?.locked === true;

  // Convert sessions array to a Map for O(1) lookup
  const sessionsMap = new Map(sessions.map(s => [s.id, s]));

  // Update sub-modules
  updateSessions(sessions, conference, schedule);
  updateBlocksState(schedule, locked);
  updateDragDropState(schedule, locked);

  // If we have a conference (setup done), show Step 2 and render the grid
  if (conference && conference.days) {
    showScheduleSection(conference, sessionsMap, schedule, locked);
    populateSetupForm(conference);
  }
}

// ---------------------------------------------------------------------------
// Called when setup form is successfully saved
// ---------------------------------------------------------------------------

function onSetupComplete(conferenceData) {
  // The real-time watcher will pick up the new conference doc and call
  // onDataUpdate, which will show the schedule section.
  // We just scroll to it for UX.
  const schedSection = document.getElementById("step-schedule");
  if (schedSection) {
    schedSection.scrollIntoView({ behavior: "smooth" });
  }
}

// ---------------------------------------------------------------------------
// Called when sessions are added/changed (handled by watcher, but hook exists)
// ---------------------------------------------------------------------------

function onSessionsChanged() {
  // The real-time watcher handles re-renders automatically.
  // This is called after a session is saved from the modal, for immediate
  // feedback (the watcher may have a slight delay).
}

// ---------------------------------------------------------------------------
// Show / render the schedule section
// ---------------------------------------------------------------------------

function showScheduleSection(conference, sessionsMap, schedule, locked) {
  const section = document.getElementById("step-schedule");
  section.classList.remove("hidden");

  renderScheduleGrid(conference, sessionsMap, schedule, locked);

  // Attach drag-drop listeners to the freshly rendered grid
  const container = document.getElementById("days-container");
  attachDragListeners(container);

  // Update schedule status line
  const statusEl = document.getElementById("schedule-status");
  if (statusEl) {
    const totalSessions = getCurrentSessions().filter(s => !s.isKeynote).length +
                         getCurrentSessions().filter(s => s.isKeynote).length;
    const scheduledIds = getScheduledIds(schedule);
    const unscheduled = getCurrentSessions().filter(s => !scheduledIds.has(s.id)).length;
    if (unscheduled > 0) {
      statusEl.textContent = `⚠ ${unscheduled} session${unscheduled > 1 ? "s" : ""} not yet scheduled`;
    } else {
      statusEl.textContent = totalSessions > 0 ? `✓ All ${totalSessions} sessions scheduled` : "";
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-schedule handler
// ---------------------------------------------------------------------------

async function handleAutoSchedule(db, editorName) {
  const conf     = getCurrentConference();
  const sessions = getCurrentSessions();

  if (!conf || !conf.days || conf.days.length === 0) {
    alert("Please complete Event Setup first.");
    return;
  }
  if (sessions.length === 0) {
    alert("Add some sessions before auto-scheduling.");
    return;
  }

  const confirmed = window.confirm(
    "Auto-Schedule will replace the current schedule with a new one.\n\n" +
    "Any manual changes you've made will be overwritten. Continue?"
  );
  if (!confirmed) return;

  const btn = document.getElementById("auto-schedule-btn");
  btn.disabled = true;
  btn.textContent = "Scheduling…";

  try {
    const { warnings } = await runAutoSchedule(db, conf, sessions, editorName);
    await stampEdit(db, editorName);

    // Show warnings if any
    const panel    = document.getElementById("warnings-panel");
    const list     = document.getElementById("warnings-list");
    const countEl  = document.getElementById("warnings-count");
    const body     = document.getElementById("warnings-body");

    if (warnings.length > 0) {
      list.innerHTML = warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("");
      countEl.textContent = `(${warnings.length})`;
      panel.classList.remove("hidden");
      body.classList.remove("hidden");
    } else {
      panel.classList.add("hidden");
    }
  } catch (err) {
    console.error("Auto-schedule error:", err);
    alert("Error running auto-schedule: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Auto-Schedule";
  }
}

// ---------------------------------------------------------------------------
// Clear schedule handler
// ---------------------------------------------------------------------------

async function handleClearSchedule(db, editorName) {
  const conf = getCurrentConference();
  if (!conf || !conf.days) return;

  const confirmed = window.confirm(
    "Clear the entire schedule? Sessions will not be deleted, " +
    "but all scheduled slots will be removed."
  );
  if (!confirmed) return;

  try {
    const { saveAllScheduleDays } = await import("../firestore.js");
    const emptyMap = new Map();
    conf.days.forEach((_, i) => emptyMap.set(i, []));
    await saveAllScheduleDays(db, emptyMap, editorName);
    document.getElementById("warnings-panel").classList.add("hidden");
  } catch (err) {
    alert("Error clearing schedule: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getScheduledIds(schedule) {
  const ids = new Set();
  for (const [, dayData] of schedule) {
    if (dayData?.slots) {
      dayData.slots.forEach(s => { if (s.sessionId) ids.add(s.sessionId); });
    }
  }
  return ids;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
