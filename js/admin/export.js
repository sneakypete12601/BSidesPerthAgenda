// =============================================================================
// ADMIN: EXPORT — PDF (print) and CSV download
// =============================================================================

import { computeStartTimes, formatTime, formatDate } from "../firestore.js";

// ---------------------------------------------------------------------------
// PDF export — just triggers the browser's print dialog.
// All the visual work is done by the @media print rules in admin.css.
// ---------------------------------------------------------------------------

export function printSchedule() {
  window.print();
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Build a CSV string from the current schedule and trigger a file download.
 * @param {object} conference  - the conference config document
 * @param {Map}    scheduleMap - Map<dayIndex, dayData>
 * @param {Map}    sessionsMap - Map<sessionId, session>
 */
export function exportCSV(conference, scheduleMap, sessionsMap) {
  if (!conference || !conference.days) {
    alert("No conference data to export. Please complete Event Setup first.");
    return;
  }

  const rows = [];

  // Header row
  rows.push([
    "Day",
    "Date",
    "Start Time",
    "End Time",
    "Type",
    "Title / Label",
    "Speaker",
    "Duration (min)",
    "Session Type",
    "Keynote",
    "Confirmed"
  ]);

  conference.days.forEach((day, dayIndex) => {
    const dayData = scheduleMap.get(dayIndex);
    if (!dayData || !dayData.slots) return;

    const slotsWithTimes = computeStartTimes(day.startTime || "09:00", dayData.slots);

    slotsWithTimes.forEach(slot => {
      const startTime = formatTime(slot.startTime);
      const endMinutes = timeToMins(slot.startTime) + (slot.durationMinutes || 0);
      const endTime = formatTime(minsToTime(endMinutes));

      if (slot.type === "session") {
        const session = sessionsMap.get(slot.sessionId);
        rows.push([
          `Day ${dayIndex + 1}`,
          day.date || "",
          startTime,
          endTime,
          "Session",
          session?.title     || "(Unknown)",
          session?.speaker   || "",
          slot.durationMinutes || session?.durationMinutes || "",
          session?.isKeynote ? "Keynote" : (session?.sessionType || "Talk"),
          session?.isKeynote ? "Yes" : "No",
          session?.confirmed !== false ? "Yes" : "No (Tentative)"
        ]);
      } else if (slot.type === "block") {
        rows.push([
          `Day ${dayIndex + 1}`,
          day.date || "",
          startTime,
          endTime,
          "Block",
          slot.label || slot.blockType || "",
          "",
          slot.durationMinutes || "",
          "",
          "",
          ""
        ]);
      } else if (slot.type === "buffer") {
        rows.push([
          `Day ${dayIndex + 1}`,
          day.date || "",
          startTime,
          endTime,
          "Buffer",
          slot.label || "Break",
          "",
          slot.durationMinutes || "",
          "",
          "",
          ""
        ]);
      }
    });
  });

  // Convert rows to CSV string
  const csv = rows.map(row =>
    row.map(cell => csvEscapeCell(String(cell))).join(",")
  ).join("\r\n");

  // Trigger download
  const confName = (conference.name || "BSides Perth").replace(/\s+/g, "-");
  const year = conference.year || new Date().getFullYear();
  const filename = `${confName}-${year}-schedule.csv`;
  triggerDownload(csv, filename, "text/csv;charset=utf-8;");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csvEscapeCell(value) {
  // If the value contains commas, newlines, or quotes, wrap in double quotes
  // and escape any existing double quotes.
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function triggerDownload(content, filename, mimeType) {
  const blob = new Blob(["\uFEFF" + content], { type: mimeType }); // BOM for Excel compatibility
  const url  = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href     = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Clean up the object URL after a short delay
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
