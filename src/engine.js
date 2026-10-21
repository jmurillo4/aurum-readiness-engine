import { CHECKS } from "./checks.js";
import { indexSnapshot } from "./evidence.js";
import { STATUS, STATUS_LABEL, PRODUCER_INPUT_LABEL, DEFAULT_NEXT_ACTION } from "./statuses.js";

export const ENGINE_VERSION = "0.1.0";

// Evaluates a resolved program against a read-only snapshot of one site's Aurum records.
// Pure: no I/O, no writes, the snapshot is never modified. `asOf` is passed in so a
// result can be reproduced exactly.
export function evaluateSite(program, snapshot, { asOf }) {
  if (!asOf) throw new Error("asOf is required");
  const idx = indexSnapshot(snapshot);
  const ctx = { asOf };

  const requirements = program.requirements.map(req => {
    const check = CHECKS[req.evidence_rule?.kind];
    if (!check) throw new Error(`${req.code}: unknown evidence rule kind "${req.evidence_rule?.kind}"`);
    const finding = check(req.evidence_rule, idx, ctx);
    const producerInput = req.input_from === "producer" && finding.status === STATUS.EXTERNAL;
    return {
      code: req.code,
      version: req.version,
      title: req.title,
      category: req.category,
      source_ref: req.source_ref,
      origin: req.origin,
      status: finding.status,
      status_label: STATUS_LABEL[finding.status],
      display_label: producerInput ? PRODUCER_INPUT_LABEL : STATUS_LABEL[finding.status],
      reason: finding.reason,
      next_action: req.next_action?.[finding.status] ?? DEFAULT_NEXT_ACTION[finding.status],
      evidence: finding.evidence,
      pending_review: finding.pending ?? [],
    };
  });

  const counts = Object.fromEntries(Object.values(STATUS).map(s => [s, 0]));
  for (const r of requirements) counts[r.status] += 1;

  return {
    kind: "program_readiness",
    engine_version: ENGINE_VERSION,
    program: { code: program.code, version: program.version, status: program.status, jurisdiction: program.jurisdiction, overlays: program.overlays },
    site_id: snapshot.site.id,
    as_of: asOf,
    readiness: { total: requirements.length, counts },
    categories: program.categories,
    requirements,
  };
}
