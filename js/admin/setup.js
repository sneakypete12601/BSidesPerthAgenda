// =============================================================================
// ADMIN: STEP 1 — EVENT SETUP FORM
// =============================================================================

import {
  saveConference, initScheduleDays, formatDate
} from "../firestore.js";

let _db = null;
let _editorName = null;
let _onSetupComplete = null; // callback(conference) when form is saved

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

export function initSetup(db, editorName, onComplete) {
  _db = db;
  _editorName = editorName;
  _onSetupComplete = onComplete;

  const form = document.getElementById("setup-form");
  const numDaysSelect = document.getElementById("num-days");

  // Rebuild day rows when the day count changes
  numDaysSelect.addEventListener("change", () => {
    renderDayRows(parseInt(numDaysSelect.value, 10));
  });

  form.addEventListener("submit", handleSetupSubmit);

  // Start with 1 day row visible
  renderDayRows(1);
}

// ---------------------------------------------------------------------------
// Populate form from existing Firestore data
// ---------------------------------------------------------------------------

export function populateSetupForm(conference) {
  if (!conference) return;

  setValue("conf-name", conference.name || "BSides Perth");
  setValue("conf-year", conference.year || new Date().getFullYear() + 1);
  setValue("default-talk-duration", conference.defaultTalkDuration || 45);
  setValue("default-buffer", conference.defaultBufferTime || 10);

  const numDays = conference.days ? conference.days.length : 1;
  document.getElementById("num-days").value = String(numDays);
  renderDayRows(numDays);

  // Populate each day's date and times
  if (conference.days) {
    conference.days.forEach((day, i) => {
      setValue(`day-date-${i}`,  day.date      || "");
      setValue(`day-start-${i}`, day.startTime || "09:00");
      setValue(`day-end-${i}`,   day.endTime   || "18:00");
    });
  }
}

// ---------------------------------------------------------------------------
// Render day rows
// ---------------------------------------------------------------------------

function renderDayRows(numDays) {
  const container = document.getElementById("day-rows-container");
  // Read existing values so we don't lose them when re-rendering
  const existing = readDayRows();

  container.innerHTML = "";
  for (let i = 0; i < numDays; i++) {
    const saved = existing[i] || {};
    const row = document.createElement("div");
    row.className = "day-row";
    row.dataset.dayIndex = i;
    row.innerHTML = `
      <div class="day-row-header">Day ${i + 1}</div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="day-date-${i}">
            Date <span class="required">*</span>
          </label>
          <input type="date" id="day-date-${i}" name="day-date-${i}"
            class="form-control" required value="${saved.date || ""}">
        </div>
        <div class="form-group">
          <label class="form-label" for="day-start-${i}">
            Start time <span class="required">*</span>
          </label>
          <input type="time" id="day-start-${i}" name="day-start-${i}"
            class="form-control" required value="${saved.startTime || "09:00"}">
        </div>
        <div class="form-group">
          <label class="form-label" for="day-end-${i}">
            End time <span class="required">*</span>
          </label>
          <input type="time" id="day-end-${i}" name="day-end-${i}"
            class="form-control" required value="${saved.endTime || "18:00"}">
        </div>
      </div>`;
    container.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------------------

async function handleSetupSubmit(e) {
  e.preventDefault();

  const submitBtn = document.querySelector("#setup-form [type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    const data = readFormData();
    if (!validateSetupData(data)) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save & Continue to Sessions →";
      return;
    }

    await saveConference(_db, data, _editorName);
    await initScheduleDays(_db, data.days.length);

    if (_onSetupComplete) _onSetupComplete(data);
  } catch (err) {
    console.error("Error saving conference:", err);
    alert("Error saving: " + err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save & Continue to Sessions →";
  }
}

// ---------------------------------------------------------------------------
// Data reading & validation
// ---------------------------------------------------------------------------

function readFormData() {
  const numDays = parseInt(document.getElementById("num-days").value, 10);
  const year = parseInt(document.getElementById("conf-year").value, 10);

  return {
    name:                document.getElementById("conf-name").value.trim(),
    year,
    defaultTalkDuration: parseInt(document.getElementById("default-talk-duration").value, 10) || 45,
    defaultBufferTime:   parseInt(document.getElementById("default-buffer").value, 10) || 10,
    days:                readDayRows().slice(0, numDays)
  };
}

function readDayRows() {
  const container = document.getElementById("day-rows-container");
  const rows = container.querySelectorAll(".day-row");
  return Array.from(rows).map((row, i) => ({
    date:      (document.getElementById(`day-date-${i}`)?.value  || "").trim(),
    startTime: (document.getElementById(`day-start-${i}`)?.value || "09:00").trim(),
    endTime:   (document.getElementById(`day-end-${i}`)?.value   || "18:00").trim()
  }));
}

function validateSetupData(data) {
  if (!data.name) {
    alert("Please enter a conference name.");
    return false;
  }
  if (!data.year || data.year < 2024) {
    alert("Please enter a valid year.");
    return false;
  }
  for (let i = 0; i < data.days.length; i++) {
    const day = data.days[i];
    if (!day.date) {
      alert(`Please enter a date for Day ${i + 1}.`);
      return false;
    }
    if (!day.startTime || !day.endTime) {
      alert(`Please enter start and end times for Day ${i + 1}.`);
      return false;
    }
    if (day.startTime >= day.endTime) {
      alert(`End time must be after start time for Day ${i + 1}.`);
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Return the current number of days (used by other modules)
// ---------------------------------------------------------------------------

export function getNumDays() {
  return parseInt(document.getElementById("num-days").value, 10) || 1;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}
