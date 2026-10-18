//This script handles the regular expression parsing, converts metric depths to inches, 
//and validates whether a sample covers the requirwed soil depth range

const CM_PER_INCH = 2.54;

//parseDepth() parses free-form depth string (0-15cm, 0-6in) into an inch range.
//Returns {topIn, bottomIn} or null if invalid or ambiguous.
export function parseDepth(text){
    if(text == null) return null;

    const depthMatch = String(text)
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*(cm|centimeters?|in|inch(?:es)?|")?$/);

    if(!depthMatch) return null;
    
    const[, rawTop, rawBottom, unit] = depthMatch;  

    //Refuse to guess if no unit is provided
    if(!unit) return null;

    const factor = unit.startsWith("c") ? 1 / CM_PER_INCH : 1; 
    const top = Number(rawTop) * factor; 
    const bottom = Number(rawBottom) * factor;

    if(!(bottom > top)) return null;
    return{topIn: round(top), bottomIn: round(bottom)};
}

//Rounds the numeric value
function round(value){
    return Math.round(value*100) / 100;
}

//Evaluates whether a parsed depth satisfies the programs required interval
export function coversRange(depth, { min_top_in = 0, min_bottom_in, max_bottom_in = Infinity }) {
  if (!depth) return false;
  if (min_bottom_in == null) throw new Error("coversRange: min_bottom_in is required");
  return depth.topIn <= min_top_in && depth.bottomIn >= min_bottom_in && depth.bottomIn <= max_bottom_in;
}