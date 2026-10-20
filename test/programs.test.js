// test/programs.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { resolveProgram, validateProgram } from "../src/programs.js";

const mockRegistry = [
  {
    code: "cema216",
    version: "2024.1",
    name: "CEMA 216 Core",
    jurisdiction: "US",
    categories: [{ key: "soil_health", label: "Soil Health" }],
    requirements: [
      {
        code: "CHEM-01",
        title: "Standard Soil Chemistry",
        category: "soil_health",
        source_ref: "NRCS CEMA 216 Section 3",
        evidence_rule: {
          kind: "lab_result",
          params: { table: "chemistry_results", min_bottom_in: 6 },
        },
      },
      {
        code: "BIO-01",
        title: "Respiration Test",
        category: "soil_health",
        source_ref: "NRCS CEMA 216 Section 4",
        evidence_rule: {
          kind: "lab_result",
          params: { table: "haney_results" },
        },
      },
    ],
  },
  {
    code: "cema216-tx",
    version: "2024.1",
    name: "CEMA 216 Texas Regional Overlay",
    jurisdiction: "US-TX",
    overlay_of: { code: "cema216", version: "2024.1" },
    overrides: [
      {
        code: "CHEM-01",
        patch: {
          evidence_rule: {
            params: { min_bottom_in: 12 }, // Texas requires deeper 12-inch sampling
          },
        },
      },
    ],
    requirements: [
      {
        code: "TX-LOCAL-01",
        title: "Texas Salinity Check",
        category: "soil_health",
        source_ref: "TX NRCS Bulletin 42",
        evidence_rule: {
          kind: "lab_result",
          params: { table: "chemistry_results", metric: "ec" },
        },
      },
    ],
  },
];

test("resolveProgram: resolves base core program without state overlay", () => {
  const resolved = resolveProgram(mockRegistry, { code: "cema216" });

  assert.equal(resolved.code, "cema216");
  assert.equal(resolved.jurisdiction, "US");
  assert.equal(resolved.requirements.length, 2);
  assert.equal(resolved.overlays.length, 0);

  const chem = resolved.requirements.find((r) => r.code === "CHEM-01");
  assert.equal(chem.evidence_rule.params.min_bottom_in, 6);
});

test("resolveProgram: merges Texas overlay overrides and appends regional requirements", () => {
  const resolved = resolveProgram(mockRegistry, { code: "cema216" }, { state: "TX" });

  assert.equal(resolved.code, "cema216");
  assert.equal(resolved.jurisdiction, "US-TX");
  assert.equal(resolved.overlays.length, 1);
  assert.equal(resolved.overlays[0].code, "cema216-tx");

  // 2 core requirements + 1 Texas-specific requirement = 3 total
  assert.equal(resolved.requirements.length, 3);

  // Verifies override updated parameter from 6 to 12 inches
  const chem = resolved.requirements.find((r) => r.code === "CHEM-01");
  assert.equal(chem.evidence_rule.params.min_bottom_in, 12);
  assert.equal(chem.origin.code, "cema216-tx");
  assert.equal(chem.overridden_from.code, "cema216");

  // Verifies regional requirement was appended
  const txReq = resolved.requirements.find((r) => r.code === "TX-LOCAL-01");
  assert.ok(txReq);
  assert.equal(txReq.origin.code, "cema216-tx");
});

test("resolveProgram: throws error when requested program code is not registered", () => {
  assert.throws(
    () => resolveProgram(mockRegistry, { code: "unknown_program" }),
    /Program unknown_program not found/
  );
});

test("validateProgram: detects missing fields and unknown rule kinds", () => {
  const invalidProgram = {
    categories: [{ key: "biology", label: "Biology" }],
    requirements: [
      {
        code: "BAD-01",
        // missing title
        // missing source_ref
        category: "soil_health", // references nonexistent category
        evidence_rule: { kind: "unsupported_check_type" },
      },
    ],
  };

  const errors = validateProgram(invalidProgram, ["lab_result", "external_doc"]);
  assert.equal(errors.length, 4);
  assert.ok(errors.some((err) => err.includes("missing 'title'")));
  assert.ok(errors.some((err) => err.includes("missing 'source_ref'")));
  assert.ok(errors.some((err) => err.includes("unknown evidence rule kind")));
  assert.ok(errors.some((err) => err.includes("undefined category")));
});
test("validateProgram: refuses to run without known rule kinds", () => {
  assert.throws(() => validateProgram({ requirements: [] }), /knownRuleKinds/);
});