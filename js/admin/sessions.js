// =============================================================================
// ADMIN: SESSION MANAGEMENT — pool, add/edit/delete
// =============================================================================

import {
  addSession, updateSession, deleteSession as fsDeleteSession,
  formatDate
} from "../firestore.js";

let _db = null;
let _sessions = [];         // current sessions array (from Firestore watcher)
let _schedule = new Map();  // current schedule Map<dayIndex, dayData>
let _conference = null;
let _editorName = null;
let _locked = false;

// Callbacks so other modules can react
let _onSessionsChanged = null;

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

export function initSessions(db, editorName, onSessionsChanged) {
  _db = db;
  _editorName = editorName;
  _onSessionsChanged = onSessionsChanged;

  document.getElementById("add-session-btn").addEventListener("click", () => {
    openSessionModal(null);
  });

  // Modal close buttons
  document.getElementById("session-modal-close").addEventListener("click", closeSessionModal);
  document.getElementById("session-modal-cancel").addEventListener("click", closeSessionModal);
  document.getElementById("session-modal").addEventListener("click", e => {
    if (e.target === document.getElementById("session-modal")) closeSessionModal();
  });

  // Photo preview
  document.getElementById("sess-photo").addEventListener("input", e => {
    const url = e.target.value.trim();
    const img = document.getElementById("photo-preview");
    if (url) {
      img.src = url;
      img.onload  = () => img.classList.add("loaded");
      img.onerror = () => img.classList.remove("loaded");
    } else {
      img.classList.remove("loaded");
    }
  });

  // Form submit
  document.getElementById("session-form").addEventListener("submit", handleSessionFormSubmit);
}

// ---------------------------------------------------------------------------
// Update state (called by collab watcher)
// ---------------------------------------------------------------------------

export function updateSessions(sessions, conference, scheduleMap) {
  _sessions   = sessions;
  _conference = conference;
  _schedule   = scheduleMap;
  _locked     = conference?.locked || false;
  renderSessionPool();
}

export function setLocked(locked) {
  _locked = locked;
  document.getElementById("add-session-btn").disabled = locked;
}

// ---------------------------------------------------------------------------
// Render session pool
// ---------------------------------------------------------------------------

function renderSessionPool() {
  const list = document.getElementById("session-list");
  const countEl = document.getElementById("session-pool-count");

  if (!_sessions.length) {
    list.innerHTML = `<p class="text-muted text-sm text-center mt-4">
      No sessions yet. Click <strong>+ Add Session</strong> to get started.
    </p>`;
    countEl.textContent = "";
    return;
  }

  // Determine which sessions are scheduled
  const scheduledIds = getScheduledSessionIds();

  countEl.textContent = `${_sessions.length} session${_sessions.length !== 1 ? "s" : ""}`;

  // Sort: keynotes first, then by title
  const sorted = [..._sessions].sort((a, b) => {
    if (a.isKeynote && !b.isKeynote) return -1;
    if (!a.isKeynote && b.isKeynote) return 1;
    return (a.title || "").localeCompare(b.title || "");
  });

  list.innerHTML = sorted.map(session => renderSessionItem(session, scheduledIds.has(session.id))).join("");

  // Wire up edit/delete buttons
  list.querySelectorAll(".edit-session-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.closest("[data-session-id]").dataset.sessionId;
      const session = _sessions.find(s => s.id === id);
      if (session) openSessionModal(session);
    });
  });

  list.querySelectorAll(".delete-session-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.closest("[data-session-id]").dataset.sessionId;
      const session = _sessions.find(s => s.id === id);
      if (session) confirmDeleteSession(session);
    });
  });
}

function renderSessionItem(session, isScheduled) {
  const typeBadge = getBadgeClass(session.sessionType, session.isKeynote);
  const typeLabel = session.isKeynote ? "Keynote" : (session.sessionType || "Talk");

  return `<div class="session-item ${!isScheduled ? "unscheduled" : ""}"
               data-session-id="${session.id}">
    <div class="session-item-header">
      <div class="flex-1 truncate">
        <div class="session-item-title" title="${escapeHtml(session.title || "")}">${escapeHtml(session.title || "Untitled")}</div>
        ${session.speaker ? `<div class="session-item-speaker">${escapeHtml(session.speaker)}</div>` : ""}
      </div>
      <div class="session-item-actions">
        <button class="btn btn-sm btn-secondary edit-session-btn" title="Edit" ${_locked ? "disabled" : ""}>✏️</button>
        <button class="btn btn-sm btn-danger delete-session-btn" title="Delete" ${_locked ? "disabled" : ""}>🗑</button>
      </div>
    </div>
    <div class="session-item-meta">
      <span class="badge ${typeBadge}">${escapeHtml(typeLabel)}</span>
      ${!session.confirmed ? `<span class="badge badge-tentative">Tentative</span>` : ""}
      <span class="session-item-duration">${session.durationMinutes || 45} min</span>
      ${!isScheduled ? `<span class="text-xs" style="color:var(--color-warning)">⚠ Unscheduled</span>` : ""}
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Modal: open / close
// ---------------------------------------------------------------------------

export function openSessionModal(session) {
  const modal = document.getElementById("session-modal");
  const form  = document.getElementById("session-form");
  const title = document.getElementById("session-modal-title");

  form.reset();
  document.getElementById("photo-preview").classList.remove("loaded");
  document.getElementById("session-form-error").classList.add("hidden");

  if (session) {
    title.textContent = "Edit Session";
    document.getElementById("session-id-field").value   = session.id;
    document.getElementById("sess-title").value          = session.title || "";
    document.getElementById("sess-speaker").value        = session.speaker || "";
    document.getElementById("sess-bio").value            = session.bio || "";
    document.getElementById("sess-photo").value          = session.photoUrl || "";
    document.getElementById("sess-duration").value       = session.durationMinutes || 45;
    document.getElementById("sess-type").value           = session.sessionType || "Talk";
    document.getElementById("sess-keynote").checked      = !!session.isKeynote;
    document.getElementById("sess-confirmed").checked    = session.confirmed !== false;

    if (session.photoUrl) {
      const img = document.getElementById("photo-preview");
      img.src = session.photoUrl;
      img.onload = () => img.classList.add("loaded");
    }
  } else {
    title.textContent = "Add Session";
    document.getElementById("session-id-field").value = "";
    document.getElementById("sess-confirmed").checked = true;
    // Apply conference defaults
    if (_conference) {
      document.getElementById("sess-duration").value = _conference.defaultTalkDuration || 45;
    }
  }

  // Populate day preference dropdown
  populateDayPrefDropdown(session?.dayPreference);

  modal.classList.remove("hidden");
  document.getElementById("sess-title").focus();
}

function closeSessionModal() {
  document.getElementById("session-modal").classList.add("hidden");
}

function populateDayPrefDropdown(currentPref) {
  const sel = document.getElementById("sess-day-pref");
  sel.innerHTML = `<option value="">No preference</option>`;
  if (_conference && _conference.days) {
    _conference.days.forEach((day, i) => {
      const label = `Day ${i + 1}${day.date ? " — " + formatDate(day.date) : ""}`;
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = label;
      if (currentPref !== null && currentPref !== undefined && String(currentPref) === String(i)) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
  }
}

// ---------------------------------------------------------------------------
// Form submit: add or update session
// ---------------------------------------------------------------------------

async function handleSessionFormSubmit(e) {
  e.preventDefault();

  const errorEl  = document.getElementById("session-form-error");
  const submitBtn = document.querySelector("#session-form [type=submit]");
  errorEl.classList.add("hidden");

  const title = document.getElementById("sess-title").value.trim();
  if (!title) {
    showFormError(errorEl, "Please enter a session title.");
    return;
  }

  const dayPrefRaw = document.getElementById("sess-day-pref").value;
  const sessionData = {
    title,
    speaker:         document.getElementById("sess-speaker").value.trim(),
    bio:             document.getElementById("sess-bio").value.trim(),
    photoUrl:        document.getElementById("sess-photo").value.trim(),
    durationMinutes: parseInt(document.getElementById("sess-duration").value, 10) || 45,
    sessionType:     document.getElementById("sess-type").value,
    isKeynote:       document.getElementById("sess-keynote").checked,
    confirmed:       document.getElementById("sess-confirmed").checked,
    dayPreference:   dayPrefRaw !== "" ? parseInt(dayPrefRaw, 10) : null
  };

  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    const existingId = document.getElementById("session-id-field").value;
    if (existingId) {
      await updateSession(_db, existingId, sessionData);
    } else {
      await addSession(_db, sessionData);
    }
    closeSessionModal();
    if (_onSessionsChanged) _onSessionsChanged();
  } catch (err) {
    console.error("Error saving session:", err);
    showFormError(errorEl, "Error saving session: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Session";
  }
}

// ---------------------------------------------------------------------------
// Delete session
// ---------------------------------------------------------------------------

function confirmDeleteSession(session) {
  const confirmed = window.confirm(
    `Delete "${session.title || "this session"}"?\n\n` +
    `This will also remove it from the schedule. This cannot be undone.`
  );
  if (!confirmed) return;

  const numDays = _conference?.days?.length || 0;
  fsDeleteSession(_db, session.id, numDays).catch(err => {
    alert("Error deleting session: " + err.message);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getScheduledSessionIds() {
  const ids = new Set();
  for (const [, dayData] of _schedule) {
    if (dayData && dayData.slots) {
      dayData.slots.forEach(slot => {
        if (slot.sessionId) ids.add(slot.sessionId);
      });
    }
  }
  return ids;
}

function getBadgeClass(sessionType, isKeynote) {
  if (isKeynote) return "badge-keynote";
  const map = {
    "Talk":           "badge-talk",
    "Panel":          "badge-panel",
    "Workshop":       "badge-workshop",
    "Lightning Talk": "badge-lightning",
    "Other":          "badge-other"
  };
  return map[sessionType] || "badge-talk";
}

function showFormError(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Export sessions array for use by other modules
export function getSessions() { return _sessions; }
