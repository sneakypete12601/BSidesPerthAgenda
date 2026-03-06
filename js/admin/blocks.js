// =============================================================================
// ADMIN: NON-TALK BLOCK MANAGEMENT
// =============================================================================
// Handles adding, editing, and removing schedule blocks (Registration, Lunch, etc.)
// within each day's schedule. Works by modifying the slots array for a day
// and saving it to Firestore.
// =============================================================================

import { saveScheduleDay, generateSlotId } from "../firestore.js";

// ---------------------------------------------------------------------------
// Block type definitions
// ---------------------------------------------------------------------------

export const BLOCK_PRESETS = {
  "doors-open":       { label: "Doors Open",        defaultDuration: 30,  hasLocation: false },
  "registration":     { label: "Registration",       defaultDuration: 30,  hasLocation: false },
  "morning-break":    { label: "Morning Break",      defaultDuration: 20,  hasLocation: false },
  "lunch":            { label: "Lunch Break",        defaultDuration: 60,  hasLocation: false },
  "afternoon-break":  { label: "Afternoon Break",    defaultDuration: 20,  hasLocation: false },
  "evening-social":   { label: "Evening Social",     defaultDuration: 120, hasLocation: true  },
  "custom":           { label: "Custom Block",       defaultDuration: 30,  hasLocation: false }
};

let _db = null;
let _editorName = null;
let _schedule = new Map();   // dayIndex → dayData
let _locked = false;

// ---------------------------------------------------------------------------
// Initialise
// ---------------------------------------------------------------------------

export function initBlocks(db, editorName) {
  _db = db;
  _editorName = editorName;
  wireBlockModal();
}

export function updateBlocksState(scheduleMap, locked) {
  _schedule = scheduleMap;
  _locked   = locked;
}

// ---------------------------------------------------------------------------
// Render the "Add block" panel for a given day column
// Returns an HTML string to embed in the day column DOM.
// ---------------------------------------------------------------------------

export function renderAddBlockPanel(dayIndex) {
  return `
    <div class="add-block-panel no-print">
      <h4>Add block</h4>
      <div class="block-presets">
        ${Object.entries(BLOCK_PRESETS).map(([type, preset]) => `
          <button
            class="block-preset-btn"
            data-day="${dayIndex}"
            data-block-type="${type}"
            title="Add ${preset.label}"
            ${_locked ? "disabled" : ""}
          >${preset.label}</button>
        `).join("")}
      </div>
    </div>`;
}

// Call this after a day column is rendered to attach click handlers.
export function attachBlockPanelListeners(container) {
  container.querySelectorAll(".block-preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const dayIndex = parseInt(btn.dataset.day, 10);
      const blockType = btn.dataset.blockType;
      addBlock(dayIndex, blockType);
    });
  });
}

// ---------------------------------------------------------------------------
// Add a new block to a day
// ---------------------------------------------------------------------------

async function addBlock(dayIndex, blockType) {
  if (_locked) return;
  const preset = BLOCK_PRESETS[blockType] || BLOCK_PRESETS.custom;
  const dayData = _schedule.get(dayIndex);
  const slots = dayData ? [...(dayData.slots || [])] : [];

  const newSlot = {
    slotId:          generateSlotId(),
    type:            "block",
    blockType,
    label:           preset.label,
    durationMinutes: preset.defaultDuration,
    sessionId:       null,
    location:        ""
  };

  slots.push(newSlot);

  try {
    await saveScheduleDay(_db, dayIndex, slots, _editorName);
    // If it's evening-social or custom, immediately open the edit modal
    if (blockType === "evening-social" || blockType === "custom") {
      openBlockModal(dayIndex, newSlot);
    }
  } catch (err) {
    console.error("Error adding block:", err);
    alert("Error adding block: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Edit a block
// ---------------------------------------------------------------------------

export function openBlockModal(dayIndex, slot) {
  if (_locked) return;

  const modal = document.getElementById("block-modal");
  const preset = BLOCK_PRESETS[slot.blockType] || {};

  document.getElementById("block-modal-title").textContent = `Edit: ${slot.label || preset.label || "Block"}`;
  document.getElementById("block-day-index").value    = dayIndex;
  document.getElementById("block-slot-id").value      = slot.slotId;
  document.getElementById("block-type-field").value   = slot.blockType || "custom";
  document.getElementById("block-label").value        = slot.label || preset.label || "";
  document.getElementById("block-duration").value     = slot.durationMinutes || preset.defaultDuration || 30;
  document.getElementById("block-location").value     = slot.location || "";

  // Show location field for relevant block types
  const locGroup = document.getElementById("block-location-group");
  if (preset.hasLocation || slot.blockType === "custom") {
    locGroup.classList.remove("hidden");
  } else {
    locGroup.classList.add("hidden");
  }

  modal.classList.remove("hidden");
  document.getElementById("block-label").focus();
}

// ---------------------------------------------------------------------------
// Remove a block from a day's slots
// ---------------------------------------------------------------------------

export async function removeBlock(dayIndex, slotId) {
  if (_locked) return;
  const dayData = _schedule.get(dayIndex);
  if (!dayData) return;

  const slots = (dayData.slots || []).filter(s => s.slotId !== slotId);
  try {
    await saveScheduleDay(_db, dayIndex, slots, _editorName);
  } catch (err) {
    console.error("Error removing block:", err);
    alert("Error removing block: " + err.message);
  }
}

// ---------------------------------------------------------------------------
// Wire up block modal
// ---------------------------------------------------------------------------

function wireBlockModal() {
  const modal  = document.getElementById("block-modal");
  const form   = document.getElementById("block-form");
  const closeBtn = document.getElementById("block-modal-close");
  const cancelBtn = document.getElementById("block-modal-cancel");

  const close = () => modal.classList.add("hidden");
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const dayIndex = parseInt(document.getElementById("block-day-index").value, 10);
    const slotId   = document.getElementById("block-slot-id").value;
    const blockType = document.getElementById("block-type-field").value;

    const changes = {
      label:           document.getElementById("block-label").value.trim() || BLOCK_PRESETS[blockType]?.label || "Block",
      durationMinutes: parseInt(document.getElementById("block-duration").value, 10) || 30,
      location:        document.getElementById("block-location").value.trim()
    };

    const submitBtn = form.querySelector("[type=submit]");
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    try {
      const dayData = _schedule.get(dayIndex);
      if (dayData) {
        const slots = (dayData.slots || []).map(s =>
          s.slotId === slotId ? { ...s, ...changes } : s
        );
        await saveScheduleDay(_db, dayIndex, slots, _editorName);
      }
      close();
    } catch (err) {
      alert("Error saving block: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Save Block";
    }
  });
}
