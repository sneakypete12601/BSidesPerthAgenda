// =============================================================================
// PUBLIC PAGE ENTRY POINT
// =============================================================================
// This file is imported as a module from index.html after Firebase is
// initialised. It simply hands the Firestore db instance to the schedule
// module which handles all rendering and real-time updates.
// =============================================================================

import { initPublicSchedule } from "./schedule.js";

export function initSchedule(db) {
  initPublicSchedule(db);
}
