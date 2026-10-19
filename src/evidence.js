
//evidence.js acts the matching engine's data gatekeeper and indexing engine. It handles two tasks
//1. Release and Status Validation: Inspects lab result records and filters out anything that isn't released (results in review, in progress, or failed).
// Also checks supersedes_id so that older released results are replaced by newer releases, old results are ignored.
//2. Site Scoping and Isolation: Takes the incoming database snapshot for the site and indexes them via lookup Maps (sampleById, eventById, rowsFor)
//Guarantees that only records belonging to the target site are evaluated.


//Lifecycle states used in Aurum's lab results
export const RESULT_STATUS = Object.freeze({
  NOT_STARTED: "not started",
  IN_PROGRESS: "in progress",
  IN_REVIEW: "in review",
  RELEASED: "released",
  REVISED: "revised",
  FAILED: "failed",
  NOT_APPLICABLE: "not applicable",
});

const PENDING_STATUSES = new Set([
  RESULT_STATUS.IN_PROGRESS,
  RESULT_STATUS.IN_REVIEW,
]);

//Normalizes raw status strings for safe comparisons (In_Review -> in review)
function normalizeStatus(statusText) {
  return String(statusText ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
}

//Checks if a lab result row is released. 
//Unreleased rows (in review, in progress) do not count as evidence.
function isReleased(row) {
  return normalizeStatus(row.status) === RESULT_STATUS.RELEASED;
}
 
//Scans one of Aurum's lab result tables (chemistry_results, haney_results etc.) and builds a set of record IDs that have been
//superseded by a newer released record. 
//Invalidation guard: An older released row is only marked as superseded if its replacement row is also marked.
//If a replacement row is still under review or failed, the older released result remains the active evidence.
function supersededIds(tableRows) {
  const ids = new Set();
  for (const row of tableRows) {
    if (row.supersedes_id != null && isReleased(row)) {
      ids.add(row.supersedes_id);
    }
  }
  return ids;
}
 
/**
 * Filters rows from one of Aurum's lab result tables down to valid evidence:
 * 1. The row's lifecycle status has to be officially released
 * 2. The row hasn't been superseded by a newer released row (doesn't come up in supersededIds)
 * 
 * Runs O(n) time by checking IDs against the supersededIds set. 
 */
export function currentReleases(tableRows) {
  const superseded = supersededIds(tableRows);
  return tableRows.filter((row) => isReleased(row) && !superseded.has(row.id));
}
 
/**
 * This function verifies whether a single lab result is active/released
 * 
 * Verifies two items:
 * 1. Target row's status is explicitly marked as "released"
 * 2. No other row in the provided table is also "released" while pointing to this row in its supersedes_id. 
 * 
 * Use-Case: For single-row assertions and unit tests. For processing an entire table of results, currentReleases() is better suited for the job.
 */
export function isCurrentRelease(row, tableRows) {
  if (!isReleased(row)) return false;
 
  return !tableRows.some(
    (otherRow) =>
      otherRow !== row &&
      otherRow.supersedes_id === row.id &&
      isReleased(otherRow)
  );
}
 
/**
 * Returns true if a lab row is currently undergoing lab processing or review.
 */
export function isPending(row) {
  return PENDING_STATUSES.has(normalizeStatus(row.status));
}
 
/**
 * Builds an in-memory index of site snapshot, isolating data strictly to the target site.
 * 
 * Pre-processes related entities to guarantee clean data isolation for the target site
 * 1. Filters 'sampling_events' to only those matching 'snapshot.site.id'
 * 2. Filters 'samples' to only those linked to verified site events 
 * 3. Builds fast O(1) lookup Maps for samples and events by ID
 * 4. Provides 'rowsFor' to retrieve lab result rows belonging to site samples
 * 5. Provides 'currentReleasesFor' to pull only active, non-superseded released rows. 
 */
export function indexSnapshot(snapshot) {
  const currentSiteId = snapshot.site.id;
 
  // 1. Isolate events belonging strictly to this site
  const siteEvents = (snapshot.sampling_events ?? []).filter(
    (event) => event.site_id === currentSiteId
  );
  const siteEventIds = new Set(siteEvents.map((event) => event.id));
 
  // 2. Isolate samples belonging strictly to this site's events
  const siteSamples = (snapshot.samples ?? []).filter((sample) =>
    siteEventIds.has(sample.sampling_event_id)
  );
 
  const sampleById = new Map(siteSamples.map((sample) => [sample.id, sample]));
  const eventById = new Map(siteEvents.map((event) => [event.id, event]));
 
  // 3. Rows from one result table that belong to this site's samples
  const rowsFor = (tableName) =>
    (snapshot[tableName] ?? []).filter((row) => sampleById.has(row.sample_id));
 
  // 4. Only the current released evidence from one result table, scoped to this site
  const currentReleasesFor = (tableName) => currentReleases(rowsFor(tableName));
 
  return {
    snapshot,
    events: siteEvents,
    samples: siteSamples,
    sampleById,
    eventById,
    rowsFor,
    currentReleasesFor,
  };
}
