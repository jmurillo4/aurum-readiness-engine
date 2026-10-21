import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL?.trim().replace(/^["']|["']$/g, "");
if (/geozejcqqvmeaqgbequk/.test(url ?? "")) { console.error("Refusing to run against production."); process.exit(1); }
const supabase = createClient(url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const { error: authError } = await supabase.auth.signInWithPassword({ email: process.env.AURUM_EMAIL, password: process.env.AURUM_PASSWORD });
if (authError) { console.error(`Sign-in failed: ${authError.message}`); process.exit(1); }

const { data, error } = await supabase.from("sites").select("id, name, org_id").order("name").limit(50);
if (error) { console.error(`Reading sites failed: ${error.message}`); process.exit(1); }
if (!data.length) console.log("This user can't see any sites. It probably isn't linked to an organization yet.");
for (const s of data) console.log(`${s.id}  ${s.name ?? ""}`);