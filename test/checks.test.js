 // test/checks.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { CHECKS } from "../src/checks.js";
import { indexSnapshot } from "../src/evidence.js";
import { STATUS } from "../src/statuses.js";

const baseSnapshot = {
  site: { id: "site-1" },
  sampling_events: [{ id: "event-1", site_id: "site-1", date: "2026-06-01" }],
  samples: [
    { id: "sample-deep", sampling_event_id: "event-1", depth: "0-6 in", latitude: 31.76, longitude: -106.48 },
    { id: "sample-shallow", sampling_event_id: "event-1", depth: "0-10 cm" },
  ],
  chemistry_results: [
    { id: "chem-deep", sample_id: "sample-deep", ph: 6.8, status: "released" },
    { id: "chem-shallow", sample_id: "sample-shallow", ph: 7.0, status: "released" },
  ],
};

test("CHECKS.lab_metric: returns available when depth, metric, and status match", () => {
  const idx = indexSnapshot(baseSnapshot);
  const rule = {
    kind: "lab_metric",
    params: { table: "chemistry_results", metric: "ph", min_bottom_in: 6 },
  };

  const finding = CHECKS.lab_metric(rule, idx);
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

  const idx = indexSnapshot(shallowOnly);
  const rule = {
    kind: "lab_metric",
    params: { table: "chemistry_results", metric: "ph", min_bottom_in: 6 },
  };

  const finding = CHECKS.lab_metric(rule, idx);
  assert.equal(finding.status, STATUS.PARTIAL);
  assert.match(finding.reason, /do not satisfy required 6" depth/);
});

test("CHECKS.lab_metric: flags pending when rows are undergoing lab analysis", () => {
  const inReviewSnapshot = {
    ...baseSnapshot,
    chemistry_results: [
      { id: "chem-pending", sample_id: "sample-deep", ph: 7.2, status: "in review" },
    ],
  };

  const idx = indexSnapshot(inReviewSnapshot);
  const rule = {
    kind: "lab_metric",
    params: { table: "chemistry_results", metric: "ph", min_bottom_in: 6 },
  };

  const finding = CHECKS.lab_metric(rule, idx);
  assert.equal(finding.status, STATUS.MISSING);
  assert.equal(finding.pending, true);
});

test("CHECKS.sample_count: validates minimum sampling density", () => {
  const idx = indexSnapshot(baseSnapshot);
  const rule = { kind: "sample_count", params: { min_count: 2 } };
  const finding = CHECKS.sample_count(rule, idx);
  assert.equal(finding.status, STATUS.AVAILABLE);
});

test("CHECKS.geo_points: verifies coordinates on samples", () => {
  const idx = indexSnapshot(baseSnapshot);
  const rule = { kind: "geo_points" };
  const finding = CHECKS.geo_points(rule, idx);
  assert.equal(finding.status, STATUS.PARTIAL); // 1 has coords, 1 does not
});

test("CHECKS.external: handles producer-provided records", () => {
  const rule = { kind: "external", params: { description: "3 years organic certification records." } };
  const finding = CHECKS.external(rule);
  assert.equal(finding.status, STATUS.EXTERNAL);
});