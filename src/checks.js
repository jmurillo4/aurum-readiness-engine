/* */
// src/checks.js
import { parseDepth, coversRange } from "./depth.js";
import { isPending } from "./evidence.js";
import { STATUS } from "./statuses.js";

/**
 * Checks if a sample date falls within the required recency window.
 */
function isWithinWindow(dateStr, maxAgeDays, now = new Date()) {
  if (!maxAgeDays || !dateStr) return true;
  const sampleDate = new Date(dateStr);
  if (Number.isNaN(sampleDate.getTime())) return false;
  const diffDays = (now - sampleDate) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= maxAgeDays;
}

/**
 * Evaluates whether a lab metric exists, is released, matches method/depth,
 * and falls within any required validity window.
 */
function checkLabMetric(rule, idx, ctx = {}) {
  const {
    table,
    metric,
    min_bottom_in,
    min_top_in = 0,
    required_method,
    max_age_days,
  } = rule.params ?? {};

  if (!table) {
    throw new Error(`Rule ${rule.code || "unknown"} is missing target table parameter`);
  }

  // 1. Fetch released rows using O(N) site-scoped helper
  const releasedRows = idx.currentReleasesFor(table);
  const now = ctx.now ?? new Date();

  const validEvidence = [];
  let depthFailures = [];
  let expiredFailures = [];
  let methodFailures = [];

  for (const row of releasedRows) {
    // Check metric presence (handles both numeric and categorical text values)
    const val = row[metric];
    if (val == null || val === "") continue;

    // Optional method check (e.g., "1:1 water", "combustion")
    if (required_method && row.method && row.method !== required_method) {
      methodFailures.push(row);
      continue;
    }

    const sample = idx.sampleById.get(row.sample_id);
    if (!sample) continue;

    const event = idx.eventById.get(sample.sampling_event_id);
    const eventDate = event?.date || event?.created_at;

    // Check validity window / recency
    if (max_age_days && !isWithinWindow(eventDate, max_age_days, now)) {
      expiredFailures.push({ row, eventDate });
      continue;
    }

    // Check depth if required by rule
    if (min_bottom_in != null) {
      const parsedDepth = parseDepth(sample.depth);
      if (!parsedDepth || !coversRange(parsedDepth, { min_top_in, min_bottom_in })) {
        depthFailures.push({ row, sample, parsedDepth });
        continue;
      }
    }

    validEvidence.push({
      table,
      id: row.id,
      sample_id: row.sample_id,
      value: val,
      depth: sample.depth,
      date: eventDate,
    });
  }

  // Satisfied
  if (validEvidence.length > 0) {
    return {
      status: STATUS.AVAILABLE,
      evidence: validEvidence,
      pending: false,
      reason: `Found ${validEvidence.length} released ${table} record(s) satisfying all requirements.`,
    };
  }

  // Check if unreleased/in-review tests are currently underway
  const pendingRows = (idx.rowsFor(table) ?? []).filter(isPending);
  if (pendingRows.length > 0) {
    return {
      status: STATUS.MISSING,
      evidence: [],
      pending: true,
      reason: `${pendingRows.length} sample(s) undergoing lab analysis or review.`,
    };
  }

  // Diagnostic failure reasons
  if (depthFailures.length > 0) {
    return {
      status: STATUS.PARTIAL,
      evidence: depthFailures.map((d) => ({ table, id: d.row.id, depth: d.sample.depth })),
      pending: false,
      reason: `Samples recorded at depth ${depthFailures[0].sample.depth} do not satisfy required ${min_bottom_in}" depth.`,
    };
  }

  if (expiredFailures.length > 0) {
    return {
      status: STATUS.PARTIAL,
      evidence: expiredFailures.map((e) => ({ table, id: e.row.id, date: e.eventDate })),
      pending: false,
      reason: `Lab results exceed the maximum allowed age of ${max_age_days} days.`,
    };
  }

  if (methodFailures.length > 0) {
    return {
      status: STATUS.PARTIAL,
      evidence: methodFailures.map((m) => ({ table, id: m.id, method: m.method })),
      pending: false,
      reason: `Results used method '${methodFailures[0].method}', but '${required_method}' is required.`,
    };
  }

  return {
    status: STATUS.MISSING,
    evidence: [],
    pending: false,
    reason: `No qualifying released ${table} records found.`,
  };
}

/**
 * Verifies that a minimum count of samples was collected.
 */
function checkSampleCount(rule, idx) {
  const { min_count = 1 } = rule.params ?? {};
  const sampleCount = idx.samples.length;

  if (sampleCount >= min_count) {
    return {
      status: STATUS.AVAILABLE,
      evidence: idx.samples.map((s) => ({ id: s.id, depth: s.depth })),
      pending: false,
      reason: `Site has ${sampleCount} sample(s) (minimum required: ${min_count}).`,
    };
  }

  return {
    status: sampleCount > 0 ? STATUS.PARTIAL : STATUS.MISSING,
    evidence: idx.samples.map((s) => ({ id: s.id })),
    pending: false,
    reason: `Found ${sampleCount} sample(s), but program requires at least ${min_count}.`,
  };
}

/**
 * Verifies standalone sample depth across site samples.
 */
function checkSampleDepth(rule, idx) {
  const { min_bottom_in = 6, min_top_in = 0 } = rule.params ?? {};
  const validSamples = idx.samples.filter((s) => {
    const parsed = parseDepth(s.depth);
    return parsed && coversRange(parsed, { min_top_in, min_bottom_in });
  });

  if (validSamples.length > 0) {
    return {
      status: STATUS.AVAILABLE,
      evidence: validSamples.map((s) => ({ id: s.id, depth: s.depth })),
      pending: false,
      reason: `Samples meet the required ${min_bottom_in}" depth.`,
    };
  }

  return {
    status: idx.samples.length > 0 ? STATUS.PARTIAL : STATUS.MISSING,
    evidence: [],
    pending: false,
    reason: `No samples meet the required ${min_bottom_in}" depth.`,
  };
}

/**
 * Verifies coordinates exist on sampling locations.
 */
function checkGeoPoints(rule, idx) {
  const samplesWithCoords = idx.samples.filter(
    (s) => s.latitude != null && s.longitude != null
  );

  if (samplesWithCoords.length > 0 && samplesWithCoords.length === idx.samples.length) {
    return {
      status: STATUS.AVAILABLE,
      evidence: samplesWithCoords.map((s) => ({ id: s.id, lat: s.latitude, lng: s.longitude })),
      pending: false,
      reason: `GPS coordinates verified for all ${samplesWithCoords.length} sampling points.`,
    };
  }

  if (samplesWithCoords.length > 0) {
    return {
      status: STATUS.PARTIAL,
      evidence: samplesWithCoords.map((s) => ({ id: s.id })),
      pending: false,
      reason: `GPS coordinates present on ${samplesWithCoords.length} of ${idx.samples.length} samples.`,
    };
  }

  return {
    status: STATUS.MISSING,
    evidence: [],
    pending: false,
    reason: "Missing GPS coordinates on sampling locations.",
  };
}

/**
 * Verifies required attributes on sampling events.
 */
function checkEventField(rule, idx) {
  const { field } = rule.params ?? {};
  const validEvents = idx.events.filter((e) => e[field] != null && e[field] !== "");

  if (validEvents.length > 0) {
    return {
      status: STATUS.AVAILABLE,
      evidence: validEvents.map((e) => ({ id: e.id, [field]: e[field] })),
      pending: false,
      reason: `Event field '${field}' verified.`,
    };
  }

  return {
    status: STATUS.MISSING,
    evidence: [],
    pending: false,
    reason: `Sampling event missing required field '${field}'.`,
  };
}

/**
 * Handles baseline vs follow-up event scheduling windows.
 */
function checkEventSchedule(rule, idx, ctx = {}) {
  const { event_type = "follow_up", delay_months = 12 } = rule.params ?? {};
  const baseline = idx.events.find((e) => e.type === "baseline" || e.is_baseline);

  if (!baseline) {
    return {
      status: STATUS.MISSING,
      evidence: [],
      pending: false,
      reason: "No baseline sampling event recorded for this site.",
    };
  }

  const followUp = idx.events.find((e) => e.type === event_type && e.id !== baseline.id);
  if (followUp) {
    return {
      status: STATUS.AVAILABLE,
      evidence: [{ id: followUp.id, date: followUp.date }],
      pending: false,
      reason: `Follow-up sampling event recorded on ${followUp.date}.`,
    };
  }

  return {
    status: STATUS.FUTURE,
    evidence: [{ baseline_id: baseline.id, baseline_date: baseline.date }],
    pending: false,
    reason: `Follow-up sampling scheduled ${delay_months} months after baseline (${baseline.date || "recorded"}).`,
  };
}

/**
 * Checks for producer documentation not gathered directly in lab testing.
 */
function checkExternal(rule) {
  return {
    status: STATUS.EXTERNAL,
    evidence: [],
    pending: false,
    reason: rule.params?.description ?? "Requires external documentation or producer-supplied records.",
  };
}

/**
 * The master check registry mapping rule kinds to their execution logic.
 * Signature for all checks: (rule, idx, ctx) => finding
 */
export const CHECKS = {
  lab_metric: checkLabMetric,
  sample_count: checkSampleCount,
  sample_depth: checkSampleDepth,
  geo_points: checkGeoPoints,
  event_field: checkEventField,
  event_schedule: checkEventSchedule,
  record_fields: checkEventField,
  external: checkExternal,
};