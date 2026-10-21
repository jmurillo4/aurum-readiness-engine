// test/checks.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { CHECKS } from "../src/checks.js";
import { indexSnapshot } from "../src/evidence.js";
import { STATUS } from "../src/statuses.js";

const ctx = { asOf: "2026-10-21" };

const baseSnapshot = {
  site: { id: "site-1" },
  sampling_events: [{ id: "event-1", site_id: "site-1", sampled_at: "2026-06-01" }],
  samples: [
    { id: "sample-deep", sampling_event_id: "event-1", depth: "0-6 in", latitude: 31.76, longitude: -106.48 },
    { id: "sample-shallow", sampling_event_id: "event-1", depth: "0-10 cm" },
  ],
  chemistry_results: [
    { id: "chem-deep", sample_id: "sample-deep", ph: 6.8, status: "released", lab_date: "2026-06-05" },
    { id: "chem-shallow", sample_id: "sample-shallow", ph: 7.0, status: "released", lab_date: "2026-06-05" },
  ],
};

// The same rule shape the program JSON files use.
const phRule = {
  kind: "lab_metric",
  params: {
    sources: [{ table: "chemistry_results", column: "ph" }],
    depth: { min_top_in: 0, min_bottom_in: 6 },
  },
};

test("CHECKS.lab_metric: returns available when depth, metric, and status match", () => {
  const finding = CHECKS.lab_metric(phRule, indexSnapshot(baseSnapshot), ctx);
  assert.equal(finding.status, STATUS.AVAILABLE);
  assert.equal(finding.evidence.length, 1);
  assert.equal(finding.evidence[0].id, "chem-deep");
});

test("CHECKS.lab_metric: detects partial when only shallow samples exist", () => {
  const shallowOnly = {
    ...baseSnapshot,
    samples: [baseSnapshot.samples[1]],
    chemistry_results: [baseSnapshot.chemistry_results[1]],
  };
  const finding = CHECKS.lab_metric(phRule, indexSnapshot(shallowOnly), ctx);
  assert.equal(finding.status, STATUS.PARTIAL);
  assert.match(finding.reason, /requires 0–6 in/);
});

test("CHECKS.lab_metric: flags pending when rows are undergoing lab analysis", () => {
  const inReviewSnapshot = {
    ...baseSnapshot,
    chemistry_results: [{ id: "chem-pending", sample_id: "sample-deep", ph: 7.2, status: "in review" }],
  };
  const finding = CHECKS.lab_metric(phRule, indexSnapshot(inReviewSnapshot), ctx);
  assert.equal(finding.status, STATUS.MISSING);
  assert.equal(finding.pending.length, 1); // the in-review rows, by table and ID
  assert.equal(finding.pending[0].id, "chem-pending");
});

test("CHECKS.lab_metric: an expired result needs a future measurement", () => {
  const rule = { kind: "lab_metric", params: { ...phRule.params, validity_window_months: 3 } };
  const finding = CHECKS.lab_metric(rule, indexSnapshot(baseSnapshot), ctx);
  assert.equal(finding.status, STATUS.FUTURE);
});

test("CHECKS.lab_metric: an unrecorded method is only partial", () => {
  const rule = {
    kind: "lab_metric",
    params: { sources: [{ table: "chemistry_results", column: "ph", method_column: "ph_method" }], allowed_methods: ["water_1_1"] },
  };
  const finding = CHECKS.lab_metric(rule, indexSnapshot(baseSnapshot), ctx);
  assert.equal(finding.status, STATUS.PARTIAL);
  assert.match(finding.reason, /does not record which method/);
});

test("CHECKS.sample_count: validates minimum sampling density", () => {
  const rule = { kind: "sample_count", params: { min_samples: 2 } };
  const finding = CHECKS.sample_count(rule, indexSnapshot(baseSnapshot), ctx);
  assert.equal(finding.status, STATUS.AVAILABLE);
});

test("CHECKS.geo_points: verifies coordinates on samples", () => {
  const rule = { kind: "geo_points", params: {} };
  const finding = CHECKS.geo_points(rule, indexSnapshot(baseSnapshot), ctx);
  assert.equal(finding.status, STATUS.PARTIAL); // 1 has coords, 1 does not, and no boundary
});

test("CHECKS.external: handles producer-provided records", () => {
  const rule = { kind: "external", params: { reason: "3 years organic certification records." } };
  const finding = CHECKS.external(rule);
  assert.equal(finding.status, STATUS.EXTERNAL);
  assert.equal(finding.reason, "3 years organic certification records.");
});
