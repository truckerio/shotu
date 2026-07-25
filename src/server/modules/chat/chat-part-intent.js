const REQUEST_ACTION = /\b(?:need|needs|needed|request|requested|order|ordered|get|got|replace|replacement|require|requires|pick\s*up|bring|send)\b/i;
const PART_NOUN = /\b(?:part|filter|pump|sensor|manifold|injector|turbo|alternator|starter|battery|belt|hose|valve|head\s*gasket|headgasket|gasket|bearing|seal|compressor|brake|pad|shoe|rotor|drum|chamber|caliper|tie\s*rod|drag\s*link|air\s*bag|shock|lamp|light|mirror|radiator|cooler|relay|fuse|switch|harness|module|actuator|thermostat|water\s*pump|fuel\s*pump|oil\s*pump|clutch|fan|hub|u-?joint|spring|bushing|mount|cap|tank|line|pipe|clamp|bolt|nut|connector|solenoid|dryer|governor|wiper|blade|glass|door|handle|exhaust|dpf|def|egr)\b/i;
const PART_NUMBER_TOKEN = /\b(?=[a-z0-9-]{5,30}\b)(?=[a-z0-9-]*[a-z])(?=[a-z0-9-]*\d)[a-z0-9]+(?:-[a-z0-9]+)*\b/i;
const STATUS_UPDATE = /\b(?:installing|installed|received|approved|checking|working|found|using|completed|finished)\b/i;

function likelyPartNumber(body) {
  const match = String(body || "").match(PART_NUMBER_TOKEN);
  if (!match || match[0].replace(/-/g, "").length === 17) return "";
  return match[0];
}

function likelyPartDescription(body) {
  const text = String(body || "").trim();
  const withoutRequest = text
    .replace(/^(?:please\s+)?(?:(?:i|we)\s+)?(?:need|needs|needed|request|requested|order|ordered|require|requires|replace|replacement|bring|send|get)\s+/i, "")
    .replace(/^(?:(?:can|could|would)\s+you\s+)(?:please\s+)?(?:get|bring|send|order|find)\s+/i, "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .replace(/\s+please[.!?]?$/i, "")
    .replace(/[.!?]+$/, "")
    .trim();
  return withoutRequest || text;
}

export function classifyMechanicPartIntent({ body = "", hasAttachment = false, messageType = "normal" } = {}) {
  const text = String(body || "").trim();
  const hasAction = REQUEST_ACTION.test(text);
  const hasPartNoun = PART_NOUN.test(text);
  const partNumber = likelyPartNumber(text);
  const partDescription = likelyPartDescription(text);
  const wordCount = text ? text.split(/\s+/).length : 0;
  const shouldIdentify = Boolean(partNumber || hasAttachment);

  if (messageType === "part_request") {
    return { intent: "part_request", confidence: "high", reason: "explicit_part_request", partNumber, partDescription, shouldIdentify };
  }
  if (hasAction && (hasPartNoun || partNumber || hasAttachment)) {
    return { intent: "part_request", confidence: "high", reason: "request_action_with_part", partNumber, partDescription, shouldIdentify };
  }
  if (partNumber && wordCount <= 8) {
    return { intent: "part_request", confidence: "high", reason: "part_number", partNumber, partDescription, shouldIdentify: true };
  }
  if (hasPartNoun && wordCount <= 8 && !STATUS_UPDATE.test(text) && !/[.!?]/.test(text)) {
    return { intent: "part_request", confidence: "medium", reason: "bare_part_phrase", partNumber, partDescription, shouldIdentify };
  }
  if (hasAttachment) {
    return { intent: "part_candidate", confidence: "low", reason: text ? "photo_with_ambiguous_text" : "photo_only", partNumber, partDescription, shouldIdentify: true };
  }
  return { intent: "normal", confidence: "high", reason: "no_part_request_signal", partNumber: "", partDescription: "", shouldIdentify: false };
}

export const mechanicPartIntentPatterns = { REQUEST_ACTION, PART_NOUN, PART_NUMBER_TOKEN, STATUS_UPDATE };
