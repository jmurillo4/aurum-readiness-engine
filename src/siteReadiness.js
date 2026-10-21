import { loadSiteSnapshot } from "./loadSiteSnapshot.js";
import { resolveProgram } from "./programs.js";
import { evaluateSite } from "./engine.js";

// Server-side entry point for the portal: loads one site and returns its checklist.
// Loads through the caller's Supabase client, so row-level security decides what's visible.
export async function getSiteReadiness(client, siteId, {
  registry,
  programCode = "USDA_NRCS_CEMA_216",
  asOf = new Date().toISOString().slice(0, 10),
} = {}) {
  const snapshot = await loadSiteSnapshot(client, siteId);
  const state = snapshot.organizations.find(o => o.id === snapshot.site.organization_id)?.state;
  const program = resolveProgram(registry, { code: programCode }, { state });
  return evaluateSite(program, snapshot, { asOf });
}
