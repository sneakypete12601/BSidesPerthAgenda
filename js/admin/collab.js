// =============================================================================
// ADMIN: COLLABORATION — name prompt, last-edited display, lock/unlock
// =============================================================================

import {
  watchConference, watchSessions, watchScheduleDay,
  saveConference, formatTimestamp
} from "../firestore.js";

let _db = null;
let _conference = null;
let _sessions = [];
let _schedule = new Map();   // dayIndex → dayData
let _editorName = null;
let _unsubscribers = [];
let _dayListenerCount = 0;

// External callback: called whenever any data changes
let _onUpdate = null;

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

/**
 * Start all real-time listeners.
 * @param {Firestore} db
 * @param {string}    editorName
 * @param {function}  onUpdate - callback({ conference, sessions, schedule, editorName })
 */
export function initCollab(db, editorName, onUpdate) {
  _db         = db;
  _editorName = editorName;
  _onUpdate   = onUpdate;

  startListeners();
}

function startListeners() {
  // Conference doc
  _unsubscribers.push(
    watchConference(_db, conf => {
      _conference = conf;
      updateLastEditedBar(conf);
      checkLockState(conf);
      if (conf) rebuildDayListeners(conf.days ? conf.days.length : 0);
      notifyUpdate();
    })
  );

  // Sessions
  _unsubscribers.push(
    watchSessions(_db, sessions => {
      _sessions = sessions;
      notifyUpdate();
    })
  );
}

function rebuildDayListeners(numDays) {
  if (numDays === _dayListenerCount) return;

  // Remove old day listeners (first two slots are conf + sessions)
  _unsubscribers.slice(2).forEach(fn => fn());
  _unsubscribers = _unsubscribers.slice(0, 2);
  _schedule.clear();
  _dayListenerCount = numDays;

  for (let i = 0; i < numDays; i++) {
    const idx = i;
    _unsubscribers.push(
      watchScheduleDay(_db, idx, dayData => {
        _schedule.set(idx, dayData);
        notifyUpdate();
      })
    );
  }
}

function notifyUpdate() {
  if (_onUpdate) {
    _onUpdate({
      conference: _conference,
      sessions:   _sessions,
      schedule:   _schedule,
      editorName: _editorName
    });
  }
}

// ---------------------------------------------------------------------------
// Editor name prompt
// ---------------------------------------------------------------------------

/**
 * Check localStorage for a saved name. If absent, show the name prompt modal.
 * Returns a Promise that resolves with the chosen name.
 */
export function promptForName() {
  return new Promise(resolve => {
    const stored = localStorage.getItem("adminEditorName");
    if (stored && stored.trim()) {
      resolve(stored.trim());
      return;
    }

    const overlay = document.getElementById("name-prompt-overlay");
    const input   = document.getElementById("name-input");
    const submit  = document.getElementById("name-submit");

    overlay.classList.remove("hidden");
    setTimeout(() => input.focus(), 100);

    const finish = () => {
      const name = input.value.trim() || "Organiser";
      localStorage.setItem("adminEditorName", name);
      overlay.classList.add("hidden");
      resolve(name);
    };

    submit.addEventListener("click", finish, { once: true });
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { submit.click(); }
    }, { once: true });
  });
}

/** Return the currently stored editor name */
export function getEditorName() {
  return localStorage.getItem("adminEditorName") || "Organiser";
}

// ---------------------------------------------------------------------------
// Last-edited bar
// ---------------------------------------------------------------------------

function updateLastEditedBar(conf) {
  const bar = document.getElementById("last-edited-bar");
  if (!bar) return;
  if (!conf || !conf.lastEditedBy) {
    bar.textContent = "";
    return;
  }
  const when = conf.lastEditedAt ? formatTimestamp(conf.lastEditedAt) : "";
  bar.textContent = `Last edited by ${conf.lastEditedBy}${when ? " · " + when : ""}`;
}

// ---------------------------------------------------------------------------
// Lock / Unlock
// ---------------------------------------------------------------------------

function checkLockState(conf) {
  const locked    = conf?.locked === true;
  const banner    = document.getElementById("lock-banner");
  const lockBtn   = document.getElementById("lock-toggle-btn");
  const unlockBtn = document.getElementById("unlock-btn");

  if (banner) {
    if (locked) banner.classList.remove("hidden");
    else        banner.classList.add("hidden");
  }

  if (lockBtn) {
    lockBtn.textContent = locked ? "🔓 Unlock Schedule" : "🔒 Lock Schedule";
  }

  // Disable / enable all interactive admin elements when locked
  setAdminInputsDisabled(locked);
}

export function initLockControls(db, getConf) {
  const lockBtn   = document.getElementById("lock-toggle-btn");
  const unlockBtn = document.getElementById("unlock-btn");

  lockBtn?.addEventListener("click", async () => {
    const conf = getConf();
    const newState = !(conf?.locked === true);
    const msg = newState
      ? "Lock the schedule? Organizers won't be able to make changes until it's unlocked."
      : "Unlock the schedule?";
    if (!window.confirm(msg)) return;
    try {
      await saveConference(db, { locked: newState }, getEditorName());
    } catch (err) {
      alert("Error: " + err.message);
    }
  });

  unlockBtn?.addEventListener("click", async () => {
    try {
      await saveConference(db, { locked: false }, getEditorName());
    } catch (err) {
      alert("Error: " + err.message);
    }
  });
}

function setAdminInputsDisabled(disabled) {
  // Disable all form controls except the lock button itself
  const selectors = [
    "#setup-form input",
    "#setup-form select",
    "#setup-form textarea",
    "#setup-form button:not([id='lock-toggle-btn'])",
    "#add-session-btn",
    "#auto-schedule-btn",
    "#clear-schedule-btn"
  ];
  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.disabled = disabled;
    });
  });
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export function stopCollab() {
  _unsubscribers.forEach(fn => fn());
  _unsubscribers = [];
}

// Expose state getters for other modules
export function getCurrentConference() { return _conference; }
export function getCurrentSessions()   { return _sessions; }
export function getCurrentSchedule()   { return _schedule; }
