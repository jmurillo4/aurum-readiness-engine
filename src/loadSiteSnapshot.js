// Builds the snapshot evaluateSite() expects by reading one site's rows from Supabase.
// Read-only: it only calls select(). Pass a supabase-js client created with the signed-in
// user's session so Aurum's row-level security still decides what can be read.
// Table names are from the planning doc and must be confirmed against Aurum's schema.

export const DEFAULT_TABLES = Object.freeze({
  sites: "sites",
  organizations: "organizations",
  site_boundaries: "site_boundaries",
  sampling_events: "sampling_events",
  samples: "samples",
  results: ["chemistry_results", "haney_results", "plfa_results", "physical_results"],
});

export async function loadSiteSnapshot(client, siteId, { tables = DEFAULT_TABLES } = {}) {
  if (!client?.from) throw new Error("loadSiteSnapshot needs a Supabase client");
  if (siteId == null) throw new Error("loadSiteSnapshot needs a site id");

  const site = await result(client.from(tables.sites).select("*").eq("id", siteId).maybeSingle(), tables.sites);
  if (!site) throw new Error(`Site ${siteId} not found or not visible to this user`);

  const [organizations, site_boundaries, sampling_events] = await Promise.all([
    site.organization_id == null ? [] : rows(client.from(tables.organizations).select("*").eq("id", site.organization_id), tables.organizations),
    rows(client.from(tables.site_boundaries).select("*").eq("site_id", siteId), tables.site_boundaries),
    rows(client.from(tables.sampling_events).select("*").eq("site_id", siteId), tables.sampling_events),
  ]);

  const samples = await rowsIn(client, tables.samples, "sampling_event_id", sampling_events.map(e => e.id));
  const sampleIds = samples.map(s => s.id);
  const resultSets = await Promise.all(tables.results.map(t => rowsIn(client, t, "sample_id", sampleIds)));

  const raw = { site, organizations, site_boundaries, sampling_events, samples };
  tables.results.forEach((t, i) => { raw[t] = resultSets[i]; });
  return normalizeSnapshot(raw);
}

// Reshapes raw Aurum rows (whether fetched live or exported via sql/export_site_snapshot.sql)
// into the field names evaluateSite() expects. Built with ?? so it is safe to run twice.
export function normalizeSnapshot(raw) {
  const { site, organizations, site_boundaries, sampling_events, samples, ...rest } = raw;

  return {
    ...rest,
    site: { ...site, organization_id: site.organization_id ?? site.org_id },
    organizations: organizations ?? [],
    site_boundaries: (site_boundaries ?? []).filter(b => b.superseded_by == null),
    sampling_events: (sampling_events ?? []).map(e => ({ ...e, sampled_at: e.sampled_at ?? e.event_date })),
    samples: (samples ?? []).map(s => ({ ...s, sampling_event_id: s.sampling_event_id ?? s.event_id })),
  };
}

async function result(query, table) {
  const { data, error } = await query;
  if (error) throw new Error(`Reading ${table} failed: ${error.message ?? error}`);
  return data;
}

async function rows(query, table) {
  return (await result(query, table)) ?? [];
}

// `.in()` with an empty list is an error in PostgREST, so skip the call.
async function rowsIn(client, table, column, ids) {
  if (ids.length === 0) return [];
  return rows(client.from(table).select("*").in(column, ids), table);
}
