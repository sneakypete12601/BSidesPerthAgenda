// =============================================================================
// FIRESTORE HELPERS — shared data layer for both admin and public pages
// =============================================================================
// All functions accept a Firestore `db` instance as their first argument.
// This keeps Firebase initialisation in the page-level scripts (admin.html,
// index.html) and the data layer purely functional.
// =============================================================================

import {
  collection, doc, getDoc, getDocs,
  setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import { CONFERENCE_ID } from "./firebase-config.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function confDoc(db) {
  return doc(db, "conferences", CONFERENCE_ID);
}

function sessionsCol(db) {
  return collection(db, "conferences", CONFERENCE_ID, "sessions");
}

function sessionDoc(db, sessionId) {
  return doc(db, "conferences", CONFERENCE_ID, "sessions", sessionId);
}

function scheduleDayDoc(db, dayIndex) {
  return doc(db, "conferences", CONFERENCE_ID, "schedule", `day-${dayIndex}`);
}

// ---------------------------------------------------------------------------
// One-time reads
// ---------------------------------------------------------------------------

/** Fetch the conference config document once. Returns null if it doesn't exist. */
export async function getConference(db) {
  const snap = await getDoc(confDoc(db));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** Fetch all sessions once. Returns an array of session objects with their Firestore IDs. */
export async function getSessions(db) {
  const snap = await getDocs(sessionsCol(db));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Fetch a single day's schedule once. Returns null if not yet created. */
export async function getScheduleDay(db, dayIndex) {
  const snap = await getDoc(scheduleDayDoc(db, dayIndex));
  return snap.exists() ? snap.data() : null;
}

/** Fetch all schedule day documents. Returns a Map<dayIndex, data>. */
export async function getAllScheduleDays(db, numDays) {
  const results = new Map();
  const promises = Array.from({ length: numDays }, (_, i) =>
    getScheduleDay(db, i).then(data => {
      if (data) results.set(i, data);
    })
  );
  await Promise.all(promises);
  return results;
}

// ---------------------------------------------------------------------------
// Real-time listeners (onSnapshot)
// ---------------------------------------------------------------------------

/**
 * Watch the conference document for real-time changes.
 * @param {Firestore} db
 * @param {function} callback - called with the conference data object (or null)
 * @returns {function} unsubscribe function
 */
export function watchConference(db, callback) {
  return onSnapshot(confDoc(db), snap => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

/**
 * Watch all sessions for real-time changes.
 * @param {Firestore} db
 * @param {function} callback - called with an array of session objects
 * @returns {function} unsubscribe function
 */
export function watchSessions(db, callback) {
  return onSnapshot(sessionsCol(db), snap => {
    const sessions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(sessions);
  });
}

/**
 * Watch a single day's schedule document.
 * @param {Firestore} db
 * @param {number} dayIndex
 * @param {function} callback - called with the day data object (or null)
 * @returns {function} unsubscribe function
 */
export function watchScheduleDay(db, dayIndex, callback) {
  return onSnapshot(scheduleDayDoc(db, dayIndex), snap => {
    callback(snap.exists() ? snap.data() : null);
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Save (merge) conference config. Also stamps lastEditedBy/At if editorName provided.
 */
export async function saveConference(db, data, editorName = null) {
  const payload = { ...data };
  if (editorName) {
    payload.lastEditedBy = editorName;
    payload.lastEditedAt = serverTimestamp();
  }
  await setDoc(confDoc(db), payload, { merge: true });
}

/**
 * Save a day's schedule slots array.
 * Overwrites the entire day document — slots are always stored in full.
 */
export async function saveScheduleDay(db, dayIndex, slots, editorName = null) {
  const payload = {
    dayIndex,
    slots,
    updatedAt: serverTimestamp()
  };
  if (editorName) {
    payload.lastEditedBy = editorName;
  }
  await setDoc(scheduleDayDoc(db, dayIndex), payload);
}

/**
 * Save multiple schedule days in a single Firestore batch write.
 * Used by the auto-scheduler to commit all days atomically.
 * @param {Firestore} db
 * @param {Map<number, Array>} scheduleMap - Map of dayIndex → slots array
 * @param {string|null} editorName
 */
export async function saveAllScheduleDays(db, scheduleMap, editorName = null) {
  const batch = writeBatch(db);
  for (const [dayIndex, slots] of scheduleMap) {
    const ref = scheduleDayDoc(db, dayIndex);
    const payload = { dayIndex, slots, updatedAt: serverTimestamp() };
    if (editorName) payload.lastEditedBy = editorName;
    batch.set(ref, payload);
  }
  await batch.commit();
}

/**
 * Initialise empty schedule day documents for days that don't have one yet.
 * Safe to call multiple times — preserves existing schedule data.
 */
export async function initScheduleDays(db, numDays) {
  const checks = Array.from({ length: numDays }, async (_, i) => {
    const snap = await getDoc(scheduleDayDoc(db, i));
    if (!snap.exists()) {
      await setDoc(scheduleDayDoc(db, i), {
        dayIndex: i,
        slots: [],
        updatedAt: serverTimestamp()
      });
    }
  });
  await Promise.all(checks);
}

/**
 * Add a new session. Returns the new session's Firestore document ID.
 */
export async function addSession(db, sessionData) {
  const payload = {
    ...sessionData,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = await addDoc(sessionsCol(db), payload);
  return ref.id;
}

/**
 * Update an existing session by ID. Merges the given fields.
 */
export async function updateSession(db, sessionId, changes) {
  await updateDoc(sessionDoc(db, sessionId), {
    ...changes,
    updatedAt: serverTimestamp()
  });
}

/**
 * Delete a session by ID. Also removes it from all schedule day slot arrays.
 */
export async function deleteSession(db, sessionId, numDays) {
  // Remove from schedule first
  if (numDays) {
    const batch = writeBatch(db);
    for (let i = 0; i < numDays; i++) {
      const snap = await getDoc(scheduleDayDoc(db, i));
      if (snap.exists()) {
        const data = snap.data();
        const filtered = (data.slots || []).filter(s => s.sessionId !== sessionId);
        if (filtered.length !== (data.slots || []).length) {
          batch.update(scheduleDayDoc(db, i), {
            slots: filtered,
            updatedAt: serverTimestamp()
          });
        }
      }
    }
    await batch.commit();
  }
  await deleteDoc(sessionDoc(db, sessionId));
}

/**
 * Update just the lastEditedBy / lastEditedAt fields on the conference document.
 */
export async function stampEdit(db, editorName) {
  await updateDoc(confDoc(db), {
    lastEditedBy: editorName,
    lastEditedAt: serverTimestamp()
  });
}

// ---------------------------------------------------------------------------
// Utility: compute slot start times (pure — does not write to Firestore)
// ---------------------------------------------------------------------------

/**
 * Walk through a day's slots and compute the absolute start time for each slot.
 * Start times are not stored in Firestore; they're computed fresh each render
 * to avoid stale data when durations change.
 *
 * @param {string} dayStartTime - "HH:MM" string (e.g. "09:00")
 * @param {Array}  slots        - the slots array from Firestore
 * @returns {Array} - new array of slots each with a `startTime` ("HH:MM") property added
 */
export function computeStartTimes(dayStartTime, slots) {
  let minutes = timeToMinutes(dayStartTime);
  return slots.map(slot => {
    const startTime = minutesToTime(minutes);
    minutes += (slot.durationMinutes || 0);
    return { ...slot, startTime };
  });
}

// ---------------------------------------------------------------------------
// Time utilities (exported so other modules can use them)
// ---------------------------------------------------------------------------

/** Convert "HH:MM" → total minutes from midnight */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/** Convert total minutes from midnight → "HH:MM" */
export function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Format "HH:MM" → "9:00 AM" for display.
 * If the schedule runs past midnight (unlikely but possible) it wraps correctly.
 */
export function formatTime(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/** Format a Firestore Timestamp (or Date) to a human-readable string. */
export function formatTimestamp(ts) {
  if (!ts) return "";
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit"
  });
}

/** Format an ISO date string ("2026-08-15") to "Saturday 15 August 2026". */
export function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });
}

/** Format an ISO date string to a short form: "Sat 15 Aug". */
export function formatDateShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "short", day: "numeric", month: "short"
  });
}

/** Generate a simple unique ID for slot objects (not Firestore IDs). */
export function generateSlotId() {
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
