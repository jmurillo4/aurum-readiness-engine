//This is a strict shared constants file that defines frozen status strings, UI display labels,
//and fallback action messages the rest of the engine can use as consistent vocabular without
//any hardcoded strings

//The 5 permitted core statuses for every program requirement
// Lab tests, Sampling rules, field visit detail, outside documentation
export const STATUS = Object.freeze({
    AVAILABLE: "available",
    PARTIAL: "partial",
    MISSING: "missing",
    EXTERNAL: "external",
    FUTURE: "future",
});

//UI badges to be displayed in reports and dashboards
export const STATUS_LABEL = Object.freeze({
  available: "Available",
  partial: "Partially available",
  missing: "Missing",
  external: "Needs outside documentation",
  future: "Needs a future measurement",
});

//Display label for when land manager must provide the record themselves
export const PRODUCER_INPUT_LABEL = "Needs your input";

//Provides the user (land manager) with fallback instructions on what to do next based 
//on the requirements outcome
export const DEFAULT_NEXT_ACTION = Object.freeze({
  available: "No action needed. Aurum evidence on record covers this requirement.",
  partial: "Aurum has related evidence, but it does not fully meet the requirement. See the reason.",
  missing: "No released Aurum result covers this yet.",
  external: "Provide documentation from outside Aurum.",
  future: "A new measurement will be needed.",
});