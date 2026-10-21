// Runs the CEMA 216 checklist for one real site in Aurum's DEV Supabase.
//   npm install @supabase/supabase-js
//   copy .env.example to .env and fill it in (dev project, anon key, a dev portal login), then:
//   npm run site -- <site-id> [asOf]
// Signs in as a normal user so row-level security applies. Never uses the service-role key.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { evaluateSite, resolveProgram, loadSiteSnapshot } from "../src/index.js";

const { SUPABASE_ANON_KEY, AURUM_EMAIL, AURUM_PASSWORD } = process.env;
const SUPABASE_URL = process.env.SUPABASE_URL?.trim().replace(/^["']|["']$/g, "");
const [siteId, asOf = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !siteId) {
  console.error("Usage: fill in .env, then npm run site -- <site-id> [asOf]");
  process.exit(1);
}
if (!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(SUPABASE_URL)) {
  console.error(`SUPABASE_URL should look like https://<project-ref>.supabase.co with nothing after it. Got: ${SUPABASE_URL}`);
  console.error("Use the Project URL from Project Settings > API, not the dashboard link in your browser.");
  process.exit(1);
}
if (/geozejcqqvmeaqgbequk/.test(SUPABASE_URL)) {
  console.error("Refusing to run against the production Supabase project. Use aurum-portal-dev.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
if (AURUM_EMAIL) {
  let error;
  try {
    ({ error } = await supabase.auth.signInWithPassword({ email: AURUM_EMAIL, password: AURUM_PASSWORD }));
  } catch (e) {
    error = e;
  }
  if (error) {
    console.error(`Sign-in failed: ${error.message}`);
    if (/not valid JSON|DOCTYPE/.test(error.message)) {
      console.error(`${SUPABASE_URL} answered with a web page, not the Supabase API. Check the URL, and whether the project is paused.`);
    }
    process.exit(1);
  }
}

const load = p => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const registry = [load("../programs/cema216-core.json"), load("../programs/cema216-tx-overlay.json")];
const snapshot = await loadSiteSnapshot(supabase, siteId);
const state = snapshot.organizations[0]?.state;
const result = evaluateSite(resolveProgram(registry, { code: "USDA_NRCS_CEMA_216" }, { state }), snapshot, { asOf });

console.log(`Site ${siteId} · as of ${asOf} ·`, Object.entries(result.readiness.counts).map(([k, v]) => `${k} ${v}`).join(", "));
for (const r of result.requirements) console.log(`  ${r.code.padEnd(7)} ${r.display_label.padEnd(28)} ${r.reason}`);