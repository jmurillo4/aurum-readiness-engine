import { STATUS } from "./statuses.js";
import { isPending } from "./evidence.js";
import { parseDepth, coversRange } from "./depth.js";

// One handler per evidence-rule kind. Handlers are pure: (rule, index, ctx) -> finding.
// A finding is { status, reason, evidence: [{ table, id, ... }], pending?: [...] }.

export const CHECKS = {
  lab_metric: checkLabMetric,
  sample_count: checkSampleCount,
  sample_depth: checkSampleDepth,
  event_field: checkEventField,
  geo_points: checkGeoPoints,
  event_schedule: checkEventSchedule,
  record_fields: checkRecordFields,
  external: checkExternal,
};

function ref(table, row, extra = {}) {
  return { table, id: row.id, ...extra };
}

function monthsBetween(from, to) {
  const a = new Date(from);
  const b = new Date(to);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) - (b.getUTCDate() < a.getUTCDate() ? 1 : 0);
}

// A lab indicator. Every current release carrying the metric is judged on age, then
// method, then depth. If any passes, the requirement is Available and cites every passing
// record. Otherwise the newest record's failure is reported: too old -> Needs a future
// measurement; unknown/wrong method or depth -> Partially available; none -> Missing.
function checkLabMetric(rule, idx, ctx) {
  const p = rule.params;
  if (!p?.sources?.length) throw new Error("lab_metric rule needs at least one source");
  const candidates = [];
  const pending = [];
  for (const src of p.sources) {
    const current = new Set(idx.currentReleasesFor(src.table));
    for (const row of idx.rowsFor(src.table)) {
      if (row[src.column] == null || row[src.column] === "") continue;
      if (current.has(row)) candidates.push({ src, row });
      else if (isPending(row)) pending.push(ref(src.table, row, { column: src.column, status: row.status }));
    }
  }

  if (candidates.length === 0) {
    return {
      status: STATUS.MISSING,
      reason: pending.length
        ? "A result for this is in Aurum's review and has not been released yet."
        : "No released Aurum result records this measurement.",
      evidence: [],
      pending,
    };
  }

  candidates.sort((a, b) => String(b.row.lab_date ?? "").localeCompare(String(a.row.lab_date ?? "")));
  const findings = candidates.map(c => judgeLabRow(c, p, idx, ctx));
  const passing = findings.filter(f => f.status === STATUS.AVAILABLE);
  if (passing.length) {
    return { status: STATUS.AVAILABLE, reason: "Covered by a released Aurum result.", evidence: passing.flatMap(f => f.evidence), pending };
  }
  return { ...findings[0], pending };
}

function judgeLabRow({ src, row }, p, idx, ctx) {
  const evidence = [ref(src.table, row, { column: src.column, lab_date: row.lab_date ?? null })];

  if (p.validity_window_months != null) {
    if (!row.lab_date) return { status: STATUS.PARTIAL, reason: "The result has no lab date, so its age cannot be confirmed.", evidence };
    if (monthsBetween(row.lab_date, ctx.asOf) > p.validity_window_months) {
      return {
        status: STATUS.FUTURE,
        reason: `The newest released result (${row.lab_date}) is older than ${p.validity_window_months} months.`,
        evidence,
      };
    }
  }

  if (p.allowed_methods?.length) {
    const method = src.method_column ? row[src.method_column] : null;
    if (method == null || method === "") {
      return { status: STATUS.PARTIAL, reason: `Aurum does not record which method was used; the program accepts ${p.allowed_methods.join(", ")}.`, evidence };
    }
    if (!p.allowed_methods.includes(String(method).toLowerCase())) {
      return { status: STATUS.PARTIAL, reason: `Measured by ${method}; the program accepts ${p.allowed_methods.join(", ")}.`, evidence };
    }
  } else if (src.accepted_method) {
    // The source table itself implies an accepted method (e.g. Haney, PLFA).
    evidence[0].method = src.accepted_method;
  }

  if (p.depth) {
    const sample = idx.sampleById.get(row.sample_id);
    const depth = parseDepth(sample?.depth);
    if (!coversRange(depth, p.depth)) {
      return {
        status: STATUS.PARTIAL,
        reason: depth
          ? `Sampled ${sample.depth} (${depth.topIn}–${depth.bottomIn} in); the program requires 0–${p.depth.min_bottom_in} in.`
          : `Sample depth "${sample?.depth ?? "not recorded"}" could not be read.`,
        evidence,
      };
    }
  }

  return { status: STATUS.AVAILABLE, reason: "Covered by a released Aurum result.", evidence };
}

// Minimum composite samples per field per visit. Uses the event with the most samples.
function checkSampleCount(rule, idx) {
  const min = rule.params.min_samples;
  let best = null;
  for (const event of idx.events) {
    const n = idx.samples.filter(s => s.sampling_event_id === event.id).length;
    if (!best || n > best.n) best = { event, n };
  }
  if (!best || best.n === 0) return { status: STATUS.MISSING, reason: "No samples on record for this site.", evidence: [] };
  const evidence = [ref("sampling_events", best.event, { sample_count: best.n })];
  if (best.n >= min) return { status: STATUS.AVAILABLE, reason: `${best.n} samples in one visit (at least ${min} required).`, evidence };
  return { status: STATUS.PARTIAL, reason: `Only ${best.n} sample(s) in one visit; at least ${min} required.`, evidence };
}

function checkSampleDepth(rule, idx) {
  if (idx.samples.length === 0) return { status: STATUS.MISSING, reason: "No samples on record for this site.", evidence: [] };
  const bad = [];
  const evidence = [];
  for (const s of idx.samples) {
    const d = parseDepth(s.depth);
    evidence.push(ref("samples", s, { depth: s.depth ?? null }));
    if (!coversRange(d, rule.params)) bad.push(`${s.depth ?? "not recorded"}${d ? ` (${d.topIn}–${d.bottomIn} in)` : ""}`);
  }
  if (bad.length === 0) return { status: STATUS.AVAILABLE, reason: "All samples cover the required depth.", evidence };
  return {
    status: STATUS.PARTIAL,
    reason: `${bad.length} of ${idx.samples.length} sample(s) do not cover 0–${rule.params.min_bottom_in} in: ${[...new Set(bad)].join("; ")}.`,
    evidence,
  };
}

// A field on the sampling event that Aurum records but cannot fully prove on its own
// (e.g. collector name without qualifications). `complete_when_present` decides which.
function checkEventField(rule, idx) {
  const { field, complete_when_present = false, partial_reason } = rule.params;
  const hits = idx.events.filter(e => e[field] != null && e[field] !== "");
  if (hits.length === 0) return { status: STATUS.MISSING, reason: `No sampling visit records ${field.replace(/_/g, " ")}.`, evidence: [] };
  const evidence = hits.map(e => ref("sampling_events", e, { field }));
  if (complete_when_present) return { status: STATUS.AVAILABLE, reason: "Recorded on the sampling visit.", evidence };
  return { status: STATUS.PARTIAL, reason: partial_reason ?? "Recorded, but needs confirmation outside Aurum.", evidence };
}

function checkGeoPoints(rule, idx) {
  const boundaries = (idx.snapshot.site_boundaries ?? []).filter(b => b.site_id === idx.snapshot.site.id);
  const located = idx.samples.filter(s => s.latitude != null && s.longitude != null);
  const evidence = [...boundaries.map(b => ref("site_boundaries", b)), ...located.map(s => ref("samples", s))];
  if (boundaries.length && located.length && located.length === idx.samples.length) {
    return { status: STATUS.AVAILABLE, reason: "Field boundary and GPS points for every sample are on record.", evidence };
  }
  if (!boundaries.length && !located.length) return { status: STATUS.MISSING, reason: "No field boundary or sample GPS points on record.", evidence };
  const gaps = [];
  if (!boundaries.length) gaps.push("no field boundary");
  if (located.length < idx.samples.length) gaps.push(`${idx.samples.length - located.length} sample(s) without GPS`);
  return { status: STATUS.PARTIAL, reason: `Partly on record: ${gaps.join(", ")}.`, evidence };
}

// Baseline must exist; a follow-up is "future" until its interval has passed.
function checkEventSchedule(rule, idx, ctx) {
  const { event_type, after_event_type, interval_months } = rule.params;
  const match = idx.events.filter(e => e.event_type === event_type);
  if (match.length) return { status: STATUS.AVAILABLE, reason: `${/^[aeiou]/i.test(event_type) ? "An" : "A"} ${event_type} sampling visit is on record.`, evidence: match.map(e => ref("sampling_events", e)) };  if (!after_event_type) return { status: STATUS.MISSING, reason: `No ${event_type} sampling visit on record.`, evidence: [] };
  const prior = idx.events.filter(e => e.event_type === after_event_type).sort((a, b) => String(b.sampled_at).localeCompare(String(a.sampled_at)))[0];
  if (!prior) return { status: STATUS.MISSING, reason: `No ${after_event_type} visit yet, so no ${event_type} visit is scheduled.`, evidence: [] };
  const due = monthsBetween(prior.sampled_at, ctx.asOf) >= interval_months;
  return {
    status: due ? STATUS.MISSING : STATUS.FUTURE,
    reason: due
      ? `The ${event_type} visit was due ${interval_months} months after the ${after_event_type} visit (${prior.sampled_at}).`
      : `The ${event_type} visit will be due ${interval_months} months after the ${after_event_type} visit (${prior.sampled_at}).`,
    evidence: [ref("sampling_events", prior)],
  };
}

// Fields on an Aurum record (e.g. organizations) plus fields Aurum never holds.
function checkRecordFields(rule, idx) {
  const { table, fields = [], external_fields = [] } = rule.params;
  const record = table === "organizations"
    ? (idx.snapshot.organizations ?? []).find(o => o.id === idx.snapshot.site.organization_id)
    : null;
  const have = record ? fields.filter(f => record[f] != null && record[f] !== "") : [];
  const evidence = record ? [ref(table, record, { fields: have })] : [];
  if (have.length === 0) return { status: STATUS.MISSING, reason: `No ${table} details on record.`, evidence };
  const missing = fields.filter(f => !have.includes(f));
  if (missing.length === 0 && external_fields.length === 0) return { status: STATUS.AVAILABLE, reason: "All details on record.", evidence };
  const parts = [];
  if (missing.length) parts.push(`missing ${missing.join(", ")}`);
  if (external_fields.length) parts.push(`still needs ${external_fields.join(", ")} from outside Aurum`);
  return { status: STATUS.PARTIAL, reason: `Partly on record: ${parts.join("; ")}.`, evidence };
}

function checkExternal(rule) {
  return { status: STATUS.EXTERNAL, reason: rule.params?.reason ?? "Aurum does not hold this information.", evidence: [] };
}
