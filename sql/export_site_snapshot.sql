-- Exports one site's full Aurum snapshot as a single JSON document, shaped for
-- loadSiteSnapshot's normalizeSnapshot(). Read-only: it only selects.
--
-- Run this ONLY against the dev project. The SQL Editor runs as the postgres role and
-- skips row-level security, so it can read rows a signed-in user would not otherwise
-- see through Aurum's RLS-protected access.

with target_site as (
  select 'PASTE-SITE-ID-HERE'::text as id
),
site_events as (
  select e.id::text as id
  from sampling_events e
  where e.site_id::text = (select id from target_site)
),
site_samples as (
  select s.id::text as id
  from samples s
  where s.event_id::text in (select id from site_events)
)
select json_build_object(
  'site', (select row_to_json(s) from sites s where s.id::text = (select id from target_site)),
  'organizations', (
    select coalesce(json_agg(o), '[]')
    from organizations o
    where o.id::text = (select s.org_id::text from sites s where s.id::text = (select id from target_site))
  ),
  'site_boundaries', (
    select coalesce(json_agg(b), '[]')
    from site_boundaries b
    where b.site_id::text = (select id from target_site)
  ),
  'sampling_events', (
    select coalesce(json_agg(e), '[]')
    from sampling_events e
    where e.id::text in (select id from site_events)
  ),
  'samples', (
    select coalesce(json_agg(smp), '[]')
    from samples smp
    where smp.id::text in (select id from site_samples)
  ),
  'chemistry_results', (
    select coalesce(json_agg(c), '[]')
    from chemistry_results c
    where c.sample_id::text in (select id from site_samples)
  ),
  'haney_results', (
    select coalesce(json_agg(h), '[]')
    from haney_results h
    where h.sample_id::text in (select id from site_samples)
  ),
  'plfa_results', (
    select coalesce(json_agg(p), '[]')
    from plfa_results p
    where p.sample_id::text in (select id from site_samples)
  ),
  'physical_results', (
    select coalesce(json_agg(ph), '[]')
    from physical_results ph
    where ph.sample_id::text in (select id from site_samples)
  )
) as site_snapshot;
