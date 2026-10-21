// Example Express route that serves a site's CEMA 216 checklist to the portal. Not imported by anything.
// The browser never runs the engine: it calls this route, which runs it server-side.
// Each request runs as the signed-in user (their access token is forwarded), so row-level security applies.
//   npm install express @supabase/supabase-js
// Must never use the service-role key; only the anon key plus the user's own token.
import { readFileSync, readdirSync } from "node:fs";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { getSiteReadiness } from "../src/siteReadiness.js";

const programsDir = new URL("../programs/", import.meta.url);
const registry = readdirSync(programsDir)
  .filter(f => f.endsWith(".json"))
  .map(f => JSON.parse(readFileSync(new URL(f, programsDir))));

const app = express();

app.get("/api/sites/:siteId/readiness", async (req, res) => {
  const token = req.get("Authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return res.status(401).json({ error: "Not signed in" });

  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  try {
    res.json(await getSiteReadiness(client, req.params.siteId, { registry }));
  } catch (e) {
    if (/not found or not visible/.test(e.message)) return res.status(404).json({ error: "Site not found" });
    console.error(e);
    res.status(500).json({ error: "Could not build the checklist" });
  }
});

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`Readiness API listening on ${port}`));
