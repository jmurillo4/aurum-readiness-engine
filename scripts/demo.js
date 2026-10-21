// Prints the CEMA 216 checklist for the synthetic fixture: node scripts/demo.js [fixture] [asOf]
import { readFileSync } from "node:fs";
import { evaluateSite, resolveProgram, normalizeSnapshot } from "../src/index.js";

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
// Windows editors often add a leading byte-order mark; strip it before parsing.
const loadFile = p => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const registry = [load("../programs/cema216-core.json"), load("../programs/cema216-tx-overlay.json"), load("../programs/mock-second-program.json")];
const snapshot = normalizeSnapshot(process.argv[2] ? loadFile(process.argv[2]) : load("../fixtures/thin-test-site.json"));
const asOf = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const state = snapshot.organizations?.find(o => o.id === snapshot.site.organization_id)?.state;

for (const code of ["USDA_NRCS_CEMA_216", "MOCK_STATE_CARBON_INCENTIVE"]) {
  const program = resolveProgram(registry, { code }, { state });
  const result = evaluateSite(program, snapshot, { asOf });
  console.log(`\n${program.name} ${program.version}${program.overlays.length ? ` + ${program.overlays.map(o => o.code).join(", ")}` : ""} · site ${result.site_id} · as of ${asOf}`);
  console.log("Readiness:", Object.entries(result.readiness.counts).map(([k, v]) => `${k} ${v}`).join(", "));
  for (const r of result.requirements) {
    const ev = r.evidence.map(e => `${e.table}:${e.id}`).join(", ");
    console.log(`  ${r.code.padEnd(7)} ${r.display_label.padEnd(28)} ${r.title}\n          ${r.reason}${ev ? `  [${ev}]` : ""}`);
  }
}
