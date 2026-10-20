/* This program treats compliance rules as data. It compiles a final, flat checklist of requirements
   by taking a base rulebook(CEMA 216 json) locating the active region overlay for the target farm's jurisdiction (CEMA 216-TX-overlay json)
   and applying overrides, and appending state-specific requirements. 
*/

/* This function resolves a core program and its jurisdiction overlays into one unified requirement list
   Programs are declarative JSON data definitions, keeping business rules outside of code. 
*/

export function resolveProgram(registry, {code, version}, {state} = {}){
    //1. Locate the core base program
    const core = registry.find(
      (program) =>
      program.code === code &&
      (!version || program.version === version) &&
      !program.overlay_of    
    );

    if (!core) {
     throw new Error(`Program ${code}${version ? `@${version}` : ""} not found`);
    }

    //2. Resolve regional jurisdiction code (e.g., TX, CA, etc.)
    const targetJurisdiction = state ? `${core.jurisdiction}-${state.toUpperCase()}` : null;
    //3. Find overlays pinned strictly to this core program, version, and jurisdiction
    const matchingOverlays = registry.filter(
    (program) =>
      program.overlay_of?.code === core.code &&
      program.overlay_of?.version === core.version &&
      program.jurisdiction === targetJurisdiction
    );

    const requirementsByCode = new Map();

    //Populate core requirements
    for (const req of core.requirements ?? []) {
    requirementsByCode.set(req.code, {
      ...req,
      origin: { code: core.code, version: core.version },
    });
  }

  //Apply overlays in order
  for (const overlay of matchingOverlays) {
    const origin = { code: overlay.code, version: overlay.version };
    //Apply rule overrides/patches
    for (const { code: reqCode, patch } of overlay.overrides ?? []) {
      const baseReq = requirementsByCode.get(reqCode);
      if (!baseReq) {
        throw new Error(`Overlay ${overlay.code} overrides unknown requirement ${reqCode}`);
      }
      requirementsByCode.set(reqCode, mergeRequirement(baseReq, patch, origin));
    }
    //Append new overlay-specific requirements
    for (const req of overlay.requirements ?? []) {
      if (requirementsByCode.has(req.code)) {
        throw new Error(`Overlay ${overlay.code} redefines existing requirement ${req.code}; use overrides instead`);
      }
      requirementsByCode.set(req.code, { ...req, origin });
    }
  }
  return {
    code: core.code,
    name: core.name,
    version: core.version,
    status: core.status,
    jurisdiction: targetJurisdiction ?? core.jurisdiction,
    overlays: matchingOverlays.map((overlay) => ({
      code: overlay.code,
      version: overlay.version,
      status: overlay.status,
    })),
    categories: core.categories ?? [],
    requirements: [...requirementsByCode.values()],
  };
}

/* Merges an overlay patch into a base requirement without mutating the original object*/
function mergeRequirement(base, patch, origin) {
    if ("code" in patch && patch.code !== base.code) {
    throw new Error(`Overlay ${origin.code} cannot modify requirement code '${base.code}'`);
  }

  const mergedRule = patch.evidence_rule
    ? {
        ...base.evidence_rule,
        ...patch.evidence_rule,
        params: {
          ...base.evidence_rule?.params,
          ...patch.evidence_rule?.params,
        },
      }
    : base.evidence_rule;

  return {
    ...base,
    ...patch,
    evidence_rule: mergedRule,
    origin,
    overridden_from: base.origin,
  };
}

/* Validates a program definition against structural constraints
   Returns an array of error messages, or an empty array if the schema is valid. 
*/ 
export function validateProgram(program, knownRuleKinds) {
  if (!Array.isArray(knownRuleKinds) || knownRuleKinds.length === 0) {
    throw new Error("validateProgram requires an array of knownRuleKinds to validate against.");
  }

  const errors = [];
  const seenCodes = new Set();
  const validCategories = new Set((program.categories ?? []).map((cat) => cat.key));

  for (const req of program.requirements ?? []) {
    if (!req.code) {
      errors.push("Requirement missing required 'code'");
      continue;
    }

    if (seenCodes.has(req.code)) {
      errors.push(`Duplicate requirement code detected: '${req.code}'`);
    }
    seenCodes.add(req.code);

    if (!req.title) errors.push(`${req.code}: missing 'title'`);
    if (!req.source_ref) errors.push(`${req.code}: missing 'source_ref'`);

    const kind = req.evidence_rule?.kind;
    if (!knownRuleKinds.includes(kind)) {
      errors.push(`${req.code}: unknown evidence rule kind '${kind}'`);
    }

    if (validCategories.size > 0 && !validCategories.has(req.category)) {
      errors.push(`${req.code}: references undefined category '${req.category}'`);
    }
  }

  return errors;
}