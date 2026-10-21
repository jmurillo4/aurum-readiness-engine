import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSite, resolveProgram, STATUS } from "../src/index.js";
import { registry, thinSite, strongSite, deepFreeze } from "./helpers.js";

const AS_OF = "2026-10-16";
const cema = state => resolveProgram(registry(), { code: "USDA_NRCS_CEMA_216" }, { state });
const byCode = result => Object.fromEntries(result.requirements.map(r => [r.code, r]));

test("thin test site matches the planning-doc findings", () => {
  const r = byCode(evaluateSite(cema("TX"), thinSite(), { asOf: AS_OF }));
  assert.equal(r["IND-01"].status, STATUS.MISSING); // no aggregate stability column
  assert.equal(r["IND-02"].status, STATUS.PARTIAL); // organic matter without method
  assert.equal(r["IND-03"].status, STATUS.AVAILABLE);
  assert.equal(r["IND-04"].status, STATUS.AVAILABLE);
  assert.equal(r["IND-05"].status, STATUS.AVAILABLE);
  assert.equal(r["IND-06"].status, STATUS.MISSING); // no lab texture
  assert.equal(r["IND-07"].status, STATUS.PARTIAL); // pH without method
  assert.equal(r["IND-08"].status, STATUS.AVAILABLE);
  assert.equal(r["SAM-03"].status, STATUS.PARTIAL); // 1 sample, needs 3
  assert.equal(r["SAM-05"].status, STATUS.PARTIAL); // 0-15 cm < 6 in
  assert.equal(r["LAB-01"].status, STATUS.EXTERNAL);
  assert.equal(r["HIST-01"].display_label, "Needs your input");
  assert.equal(r["LAB-01"].display_label, "Needs outside documentation");
});

test("every Aurum-held requirement is available on a well-documented site", () => {
  const result = evaluateSite(cema("TX"), strongSite(), { asOf: AS_OF });
  for (const r of result.requirements) {
    if (["IND-09", "DEL-01", "SAM-06", "QI-02"].includes(r.code) || r.status === STATUS.EXTERNAL) continue;
    assert.equal(r.status, STATUS.AVAILABLE, `${r.code}: ${r.reason}`);
  }
});

test("evidence points at Aurum records by table and ID, never copies values", () => {
  const r = byCode(evaluateSite(cema(), strongSite(), { asOf: AS_OF }));
  assert.equal(r["IND-02"].evidence[0].table, "chemistry_results");
  assert.match(r["IND-02"].evidence[0].id, /^c-s\d$/);
  assert.equal("combustion_organic_carbon_pct" in r["IND-02"].evidence[0], false);
});

test("only current releases count; in-review results are flagged, not silently missing", () => {
  const site = thinSite();
  site.haney_results[0].status = "in review";
  site.chemistry_results.push({ id: "chem-2", sample_id: "smp-1", status: "revised", lab_date: "2026-06-01", ph: 7.0, ph_method: "water_1_1" });
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.equal(r["IND-03"].status, STATUS.MISSING);
  assert.equal(r["IND-03"].pending_review.length, 1);
  assert.match(r["IND-03"].reason, /review/);
  assert.equal(r["IND-07"].evidence[0].id, "chem-1"); // revised row ignored
});

test("a superseded release is ignored in favour of its replacement", () => {
  const site = thinSite();
  site.chemistry_results.push({ id: "chem-2", sample_id: "smp-1", status: "released", lab_date: "2026-05-21", supersedes_id: "chem-1", ph: 7.2, ph_method: "water_1_1" });
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.equal(r["IND-07"].evidence[0].id, "chem-2");
  assert.equal(r["IND-07"].status, STATUS.AVAILABLE);
});

test("a correction still in review does not retire the release it replaces", () => {
  const site = thinSite();
  site.chemistry_results.push({ id: "chem-2", sample_id: "smp-1", status: "in review", lab_date: "2026-05-21", supersedes_id: "chem-1", ph: 7.2 });
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.equal(r["IND-07"].evidence[0].id, "chem-1");
});

test("results older than the validity window need a future measurement", () => {
  const r = byCode(evaluateSite(cema(), strongSite(), { asOf: "2027-06-01" }));
  assert.equal(r["IND-03"].status, STATUS.FUTURE);
  assert.equal(r["IND-06"].status, STATUS.AVAILABLE); // texture has no window
});

test("a wrong method is partial, with the method named", () => {
  const site = strongSite();
  for (const c of site.chemistry_results) c.combustion_organic_carbon_method = "loss_on_ignition";
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.equal(r["IND-02"].status, STATUS.PARTIAL);
  assert.match(r["IND-02"].reason, /loss_on_ignition/);
});

test("follow-up sampling becomes missing once overdue", () => {
  const r = byCode(evaluateSite(cema(), strongSite(), { asOf: "2027-04-01" }));
  assert.equal(r["IND-09"].status, STATUS.MISSING);
});

test("results from other sites are never used", () => {
  const site = thinSite();
  site.sampling_events.push({ id: "evt-x", site_id: "other-site", event_type: "baseline" });
  site.samples.push({ id: "smp-x", sampling_event_id: "evt-x", depth: "0-6 in" });
  site.physical_results.push({ id: "phys-x", sample_id: "smp-x", status: "released", lab_date: "2026-06-01", wet_aggregate_stability_pct: 30 });
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.equal(r["IND-01"].status, STATUS.MISSING);
});

test("engine is read-only: a frozen snapshot evaluates without error", () => {
  assert.doesNotThrow(() => evaluateSite(cema("TX"), deepFreeze(thinSite()), { asOf: AS_OF }));
});

test("output is stamped with program, overlay and engine versions", () => {
  const result = evaluateSite(cema("TX"), thinSite(), { asOf: AS_OF });
  assert.equal(result.program.version, "2026.1-draft");
  assert.deepEqual(result.program.overlays.map(o => o.code), ["USDA_NRCS_CEMA_216_TX"]);
  assert.ok(result.engine_version);
  assert.equal(result.as_of, AS_OF);
  for (const r of result.requirements) assert.ok(r.version && r.origin?.version);
});

test("output never uses approval or eligibility language", () => {
  const text = JSON.stringify(evaluateSite(cema("TX"), thinSite(), { asOf: AS_OF }));
  assert.doesNotMatch(text, /\b(approved|eligible|eligibility)\b/i);
});

test("asOf is required so results are reproducible", () => {
  assert.throws(() => evaluateSite(cema(), thinSite(), {}), /asOf/);
});

test("an older release with the right method still counts when the newest one lacks it", () => {
  const site = thinSite();
  site.chemistry_results.push({ id: "chem-0", sample_id: "smp-1", status: "released", lab_date: "2026-04-01", ph: 7.1, ph_method: "water_1_1" });
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.equal(r["IND-07"].status, STATUS.AVAILABLE);
  assert.deepEqual(r["IND-07"].evidence.map(e => e.id), ["chem-0"]);
});

test("Aurum's forward link: a row whose superseded_by points at a released row is retired", () => {
  const site = thinSite();
  site.chemistry_results[0].superseded_by = "chem-2";
  site.chemistry_results.push({ id: "chem-2", sample_id: "smp-1", status: "released", lab_date: "2026-05-21", ph: 7.2 });
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.deepEqual(r["IND-07"].evidence.map(e => e.id), ["chem-2"]);
});

test("Aurum's forward link: a replacement still in review does not retire the release", () => {
  const site = thinSite();
  site.chemistry_results[0].superseded_by = "chem-2";
  site.chemistry_results.push({ id: "chem-2", sample_id: "smp-1", status: "in review", lab_date: "2026-05-21", ph: 7.2 });
  const r = byCode(evaluateSite(cema(), site, { asOf: AS_OF }));
  assert.deepEqual(r["IND-07"].evidence.map(e => e.id), ["chem-1"]);
});
