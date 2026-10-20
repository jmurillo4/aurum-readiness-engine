// test/evidence.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  currentReleases,
  isCurrentRelease,
  isPending,
  indexSnapshot,
} from "../src/evidence.js";

test("currentReleases: filters out unreleased and superseded rows in O(n)", () => {
  const rows = [
    { id: "chem-1", status: "released", supersedes_id: null },
    // chem-2 is released and supersedes chem-1 -> chem-1 should be ignored
    { id: "chem-2", status: "released", supersedes_id: "chem-1" },
    // chem-3 is still in review -> should not count as release
    { id: "chem-3", status: "in review", supersedes_id: null },
  ];

  const valid = currentReleases(rows);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].id, "chem-2");
});

test("currentReleases: unreleased revision does not supersede an older release", () => {
  const rows = [
    { id: "chem-1", status: "released", supersedes_id: null },
    // Revision is still in review, so chem-1 remains active evidence
    { id: "chem-2", status: "in review", supersedes_id: "chem-1" },
  ];

  const valid = currentReleases(rows);
  assert.equal(valid.length, 1);
  assert.equal(valid[0].id, "chem-1");
});

test("isPending: identifies lab tests currently underway", () => {
  assert.equal(isPending({ status: "in progress" }), true);
  assert.equal(isPending({ status: "in review" }), true);
  assert.equal(isPending({ status: "In_Review" }), true);
  assert.equal(isPending({ status: "released" }), false);
});

test("indexSnapshot: enforces strict site isolation", () => {
  const snapshot = {
    site: { id: "site-target" },
    sampling_events: [
      { id: "event-1", site_id: "site-target" },
      { id: "event-2", site_id: "site-foreign" }, // foreign site
    ],
    samples: [
      { id: "sample-1", sampling_event_id: "event-1" },
      { id: "sample-2", sampling_event_id: "event-2" }, // foreign sample
    ],
    chemistry_results: [
      { id: "res-1", sample_id: "sample-1", status: "released" },
      { id: "res-2", sample_id: "sample-2", status: "released" }, // belongs to foreign sample
    ],
  };

  const idx = indexSnapshot(snapshot);

  assert.equal(idx.events.length, 1);
  assert.equal(idx.events[0].id, "event-1");

  assert.equal(idx.samples.length, 1);
  assert.equal(idx.samples[0].id, "sample-1");

  // foreign site results are excluded
  const siteResults = idx.currentReleasesFor("chemistry_results");
  assert.equal(siteResults.length, 1);
  assert.equal(siteResults[0].id, "res-1");

  test("a row that supersedes itself is not retired", () => {
  const rows = [{ id: "chem-1", status: "released", supersedes_id: "chem-1" }];
  assert.equal(currentReleases(rows).length, 1);
  assert.equal(isCurrentRelease(rows[0], rows), true);
});
});