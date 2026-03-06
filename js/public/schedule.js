// =============================================================================
// PUBLIC SCHEDULE PAGE — rendering and real-time update logic
// =============================================================================

import {
  watchConference, watchScheduleDay, watchSessions,
  computeStartTimes, formatTime, formatDate, formatDateShort
} from "../firestore.js";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _db = null;
let _conference = null;
let _sessions = new Map();      // sessionId → session object
let _scheduleDays = new Map();  // dayIndex → day data
let _unsubscribers = [];        // cleanup functions for onSnapshot listeners
let _activeTab = 0;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function initPublicSchedule(db) {
  _db = db;
  renderSkeleton();
  startWatching();
}

// ---------------------------------------------------------------------------
// Real-time listeners
// ---------------------------------------------------------------------------

function startWatching() {
  // Watch conference config
  _unsubscribers.push(
    watchConference(_db, conf => {
      _conference = conf;
      if (conf) {
        updateConferenceHeader(conf);
        rebuildDayListeners(conf.days ? conf.days.length : 0);
      } else {
        renderNotConfigured();
      }
    })
  );

  // Watch sessions pool
  _unsubscribers.push(
    watchSessions(_db, sessions => {
      _sessions = new Map(sessions.map(s => [s.id, s]));
      renderActiveDay();
    })
  );
}

/** When the number of days changes, tear down old day listeners and create new ones. */
let _dayListenerCount = 0;
function rebuildDayListeners(numDays) {
  if (numDays === _dayListenerCount) return;

  // Unsubscribe old day listeners (keep the first two: conf + sessions)
  _unsubscribers.slice(2).forEach(fn => fn());
  _unsubscribers = _unsubscribers.slice(0, 2);
  _scheduleDays.clear();
  _dayListenerCount = numDays;

  for (let i = 0; i < numDays; i++) {
    const idx = i;
    _unsubscribers.push(
      watchScheduleDay(_db, idx, dayData => {
        _scheduleDays.set(idx, dayData);
        if (_conference) {
          renderDayTabs(_conference.days);
          if (idx === _activeTab) renderActiveDay();
        }
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Skeleton / error states
// ---------------------------------------------------------------------------

function renderSkeleton() {
  document.getElementById("schedule-root").innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Loading schedule…</p>
    </div>`;
}

function renderNotConfigured() {
  document.getElementById("conf-title").textContent = "BSides Perth";
  document.getElementById("conf-meta").textContent = "Schedule coming soon.";
  document.getElementById("day-tabs").innerHTML = "";
  document.getElementById("schedule-root").innerHTML = `
    <div class="loading-state">
      <p class="text-muted">The schedule hasn't been published yet. Check back soon!</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Conference header
// ---------------------------------------------------------------------------

function updateConferenceHeader(conf) {
  document.getElementById("conf-title").textContent =
    `${conf.name || "BSides Perth"} ${conf.year || ""}`.trim();

  if (conf.days && conf.days.length) {
    const dates = conf.days.map(d => formatDateShort(d.date)).filter(Boolean);
    if (dates.length === 1) {
      document.getElementById("conf-meta").textContent = formatDate(conf.days[0].date);
    } else {
      document.getElementById("conf-meta").textContent = dates.join("  ·  ");
    }
  }

  document.title = `${conf.name || "BSides Perth"} ${conf.year || ""} — Schedule`.trim();
}

// ---------------------------------------------------------------------------
// Day tabs
// ---------------------------------------------------------------------------

function renderDayTabs(days) {
  const nav = document.getElementById("day-tabs");
  if (!days || days.length === 0) { nav.innerHTML = ""; return; }

  nav.innerHTML = days.map((day, i) => `
    <button
      class="day-tab ${i === _activeTab ? "active" : ""}"
      data-day="${i}"
      aria-selected="${i === _activeTab}"
    >
      <span class="day-tab-label">Day ${i + 1}</span>
      <span class="day-tab-date">${formatDateShort(day.date)}</span>
    </button>
  `).join("");

  nav.querySelectorAll(".day-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      _activeTab = parseInt(btn.dataset.day, 10);
      renderDayTabs(days);
      renderActiveDay();
    });
  });
}

// ---------------------------------------------------------------------------
// Active day schedule
// ---------------------------------------------------------------------------

function renderActiveDay() {
  if (!_conference || !_conference.days) return;
  const day = _conference.days[_activeTab];
  const dayData = _scheduleDays.get(_activeTab);

  const root = document.getElementById("schedule-root");

  if (!dayData || !dayData.slots || dayData.slots.length === 0) {
    root.innerHTML = `
      <div class="schedule-empty">
        <p class="text-muted">Schedule for this day hasn't been published yet.</p>
      </div>`;
    return;
  }

  const slotsWithTimes = computeStartTimes(day.startTime || "09:00", dayData.slots);

  root.innerHTML = `
    <div class="day-schedule" data-day="${_activeTab}">
      <div class="day-schedule-header">
        <h2>${formatDate(day.date)}</h2>
        <p class="text-muted text-sm">${formatTime(day.startTime)} – ${formatTime(day.endTime)}</p>
      </div>
      <div class="slot-list">
        ${slotsWithTimes.map(slot => renderSlot(slot)).join("")}
      </div>
    </div>`;

  // Wire up bio toggle buttons after rendering
  root.querySelectorAll(".bio-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".session-card");
      const bio = card.querySelector(".session-bio");
      const expanded = bio.classList.toggle("expanded");
      btn.textContent = expanded ? "Hide bio" : "Show bio";
      btn.setAttribute("aria-expanded", expanded);
    });
  });
}

// ---------------------------------------------------------------------------
// Slot rendering
// ---------------------------------------------------------------------------

function renderSlot(slot) {
  if (slot.type === "buffer") return renderBufferSlot(slot);
  if (slot.type === "block")  return renderBlockSlot(slot);
  if (slot.type === "session") return renderSessionSlot(slot);
  return "";
}

function renderBufferSlot(slot) {
  return `<div class="slot-buffer">
    <span class="slot-time">${formatTime(slot.startTime)}</span>
    <span class="slot-buffer-label">${escapeHtml(slot.label || "Break")}</span>
    <span class="slot-duration">${slot.durationMinutes} min</span>
  </div>`;
}

function renderBlockSlot(slot) {
  const icon = BLOCK_ICONS[slot.blockType] || "📌";
  return `<div class="slot-block slot-block-${slot.blockType || "custom"}">
    <span class="slot-time">${formatTime(slot.startTime)}</span>
    <span class="slot-block-icon">${icon}</span>
    <div class="slot-block-info">
      <span class="slot-block-label">${escapeHtml(slot.label || slot.blockType || "")}</span>
      ${slot.location ? `<span class="slot-block-meta">${escapeHtml(slot.location)}</span>` : ""}
    </div>
    <span class="slot-duration">${slot.durationMinutes} min</span>
  </div>`;
}

function renderSessionSlot(slot) {
  const session = _sessions.get(slot.sessionId);
  if (!session) {
    // Session data not loaded yet or deleted
    return `<div class="slot-session slot-session-loading">
      <span class="slot-time">${formatTime(slot.startTime)}</span>
      <span class="text-muted">Loading…</span>
    </div>`;
  }

  const endMinutes = timeToMins(slot.startTime) + (slot.durationMinutes || session.durationMinutes || 0);
  const endTime = minsToTime(endMinutes);
  const typeBadgeClass = getBadgeClass(session.sessionType, session.isKeynote);
  const typeLabel = session.isKeynote ? "Keynote" : (session.sessionType || "Talk");
  const hasBio = session.bio && session.bio.trim().length > 0;
  const hasPhoto = session.photoUrl && session.photoUrl.trim().length > 0;

  return `<div class="slot-session ${session.isKeynote ? "slot-keynote" : ""}">
    <div class="session-time-col">
      <span class="session-start">${formatTime(slot.startTime)}</span>
      <span class="session-end">${formatTime(endTime)}</span>
    </div>
    <div class="session-card">
      ${hasPhoto ? `<img class="speaker-photo" src="${escapeHtml(session.photoUrl)}"
          alt="${escapeHtml(session.speaker || "")}"
          onerror="this.style.display='none'">` : ""}
      <div class="session-info">
        <div class="session-meta">
          <span class="badge ${typeBadgeClass}">${escapeHtml(typeLabel)}</span>
          ${!session.confirmed ? `<span class="badge badge-tentative">Tentative</span>` : ""}
        </div>
        <h3 class="session-title">${escapeHtml(session.title || "Untitled")}</h3>
        ${session.speaker ? `<p class="session-speaker">${escapeHtml(session.speaker)}</p>` : ""}
        ${hasBio ? `
          <div class="session-bio" aria-hidden="true">${escapeHtml(session.bio)}</div>
          <button class="bio-toggle" aria-expanded="false">Show bio</button>
        ` : ""}
      </div>
      <div class="session-duration">${slot.durationMinutes || session.durationMinutes || 0} min</div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BLOCK_ICONS = {
  "doors-open":       "🚪",
  "registration":     "📋",
  "morning-break":    "☕",
  "lunch":            "🍽️",
  "afternoon-break":  "☕",
  "evening-social":   "🎉",
  "custom":           "📌"
};

function getBadgeClass(sessionType, isKeynote) {
  if (isKeynote) return "badge-keynote";
  const map = {
    "Talk":          "badge-talk",
    "Panel":         "badge-panel",
    "Workshop":      "badge-workshop",
    "Lightning Talk": "badge-lightning",
    "Other":         "badge-other"
  };
  return map[sessionType] || "badge-talk";
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeToMins(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function minsToTime(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}
