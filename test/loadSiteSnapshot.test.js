import test from "node:test";
import assert from "node:assert/strict";
import { loadSiteSnapshot, normalizeSnapshot } from "../src/loadSiteSnapshot.js";
import { evaluateSite, resolveProgram } from "../src/index.js";
import { registry, thinSite } from "./helpers.js";

// A tiny stand-in for supabase-js: from().select().eq()/in()/maybeSingle(), awaitable.
// It records every call so the test can prove the loader only reads.
function fakeClient(db) {
  const calls = [];
  return {
    calls,
    from(table) {
      const filters = [];
      let single = false;
      const q = {
        select(cols) { calls.push({ table, op: "select", cols }); return q; },
        eq(col, val) { filters.push(r => r[col] === val); return q; },
        in(col, vals) { filters.push(r => vals.includes(r[col])); return q; },
        maybeSingle() { single = true; return q; },
        then(resolve) {
          const data = (db[table] ?? []).filter(r => filters.every(f => f(r)));
          resolve({ data: single ? data[0] ?? null : data, error: null });
        },
      };
      for (const op of ["insert", "update", "upsert", "delete"]) q[op] = () => { calls.push({ table, op }); return q; };
      return q;
    },
  };
}

function dbFromFixture() {
  const s = thinSite();
  const otherSite = { id: "site-999", organization_id: "org-2" };
  return {
    sites: [s.site, otherSite],
    organizations: s.organizations,
    site_boundaries: s.site_boundaries,
    sampling_events: [...s.sampling_events, { id: "evt-9", site_id: "site-999", event_type: "baseline" }],
    samples: [...s.samples, { id: "smp-9", sampling_event_id: "evt-9", depth: "0-6 in" }],
    chemistry_results: s.chemistry_results,
    haney_results: s.haney_results,
    plfa_results: s.plfa_results,
    physical_results: [...s.physical_results, { id: "phys-9", sample_id: "smp-9", status: "released", wet_aggregate_stability_pct: 40 }],
  };
}

test("loads one site's rows and nothing from other sites", async () => {
  const client = fakeClient(dbFromFixture());
  const snap = await loadSiteSnapshot(client, "site-456");
  assert.equal(snap.site.id, "site-456");
  assert.deepEqual(snap.samples.map(s => s.id), ["smp-1"]);
  assert.deepEqual(snap.physical_results.map(r => r.id), ["phys-1"]);
});

test("loader only reads", async () => {
  const client = fakeClient(dbFromFixture());
  await loadSiteSnapshot(client, "site-456");
  assert.ok(client.calls.length > 0);
  assert.ok(client.calls.every(c => c.op === "select"));
});

test("a loaded snapshot gives the same checklist as the fixture", async () => {
  const program = resolveProgram(registry(), { code: "USDA_NRCS_CEMA_216" }, { state: "TX" });
  const fromDb = evaluateSite(program, await loadSiteSnapshot(fakeClient(dbFromFixture()), "site-456"), { asOf: "2026-10-16" });
  const fromFile = evaluateSite(program, thinSite(), { asOf: "2026-10-16" });
  assert.deepEqual(fromDb.requirements.map(r => [r.code, r.status]), fromFile.requirements.map(r => [r.code, r.status]));
});

test("a site with no visits loads without empty IN queries", async () => {
  const client = fakeClient({ sites: [{ id: "s-empty", organization_id: null }] });
  const snap = await loadSiteSnapshot(client, "s-empty");
  assert.deepEqual(snap.samples, []);
  assert.ok(!client.calls.some(c => c.table === "samples"));
});

test("normalizeSnapshot maps Aurum's column names and is safe to run twice", () => {
  const raw = {
    site: { id: "site-456", org_id: "org-1", name: "Test Field A" },
    site_boundaries: [
      { id: "bnd-1", site_id: "site-456", superseded_by: null },
      { id: "bnd-0", site_id: "site-456", superseded_by: "bnd-1" },
    ],
    sampling_events: [{ id: "evt-1", site_id: "site-456", event_date: "2026-05-12" }],
    samples: [{ id: "smp-1", event_id: "evt-1", depth: "0-15 cm" }],
    chemistry_results: [{ id: "chem-1", sample_id: "smp-1", status: "released" }],
  };

  const once = normalizeSnapshot(raw);
  assert.equal(once.site.organization_id, "org-1");
  assert.equal(once.organizations.length, 0);
  assert.deepEqual(once.site_boundaries.map(b => b.id), ["bnd-1"]);
  assert.equal(once.sampling_events[0].sampled_at, "2026-05-12");
  assert.equal(once.samples[0].sampling_event_id, "evt-1");
  assert.deepEqual(once.chemistry_results, raw.chemistry_results);

  const twice = normalizeSnapshot(once);
  assert.deepEqual(twice, once);
});

test("unknown site and query errors fail loudly", async () => {
  await assert.rejects(loadSiteSnapshot(fakeClient({ sites: [] }), "nope"), /not found/);
  const broken = { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle() { return this; },
    then: r => r({ data: null, error: { message: "permission denied" } }) }) };
  await assert.rejects(loadSiteSnapshot(broken, "x"), /permission denied/);
});
