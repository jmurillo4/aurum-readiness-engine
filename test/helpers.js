import { readFileSync } from "node:fs";

export const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
export const core = () => load("../programs/cema216-core.json");
export const tx = () => load("../programs/cema216-tx-overlay.json");
export const mock = () => load("../programs/mock-second-program.json");
export const registry = () => [core(), tx(), mock()];
export const thinSite = () => load("../fixtures/thin-test-site.json");

export function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

// A site that satisfies everything Aurum can hold for CEMA 216.
export function strongSite() {
  const samples = [1, 2, 3].map(i => ({ id: `s${i}`, sampling_event_id: "e1", depth: "0-6 in", latitude: 31.7, longitude: -106.4 }));
  return {
    site: { id: "site-1", organization_id: "o1" },
    organizations: [{ id: "o1", name: "Org", address: "Addr", state: "TX" }],
    site_boundaries: [{ id: "b1", site_id: "site-1" }],
    sampling_events: [{ id: "e1", site_id: "site-1", event_type: "baseline", sampled_at: "2026-03-01", collected_by: "QI Name", weather: "dry" }],
    samples,
    chemistry_results: samples.map(s => ({ id: `c-${s.id}`, sample_id: s.id, status: "released", lab_date: "2026-03-10", ph: 7, ph_method: "water_1_1", combustion_organic_carbon_pct: 2, combustion_organic_carbon_method: "dry_combustion" })),
    haney_results: samples.map(s => ({ id: `h-${s.id}`, sample_id: s.id, status: "released", lab_date: "2026-03-10", soil_respiration: 50, organic_c: 150, organic_n: 15 })),
    plfa_results: samples.map(s => ({ id: `p-${s.id}`, sample_id: s.id, status: "released", lab_date: "2026-03-10", total_biomass: 2000 })),
    physical_results: samples.map(s => ({ id: `ph-${s.id}`, sample_id: s.id, status: "released", lab_date: "2026-03-10", method: "lab", wet_aggregate_stability_pct: 40, texture_class: "loam" })),
  };
}
