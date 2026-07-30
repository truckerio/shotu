const narrative = Object.freeze({
  autoCorrect: "on",
  spellCheck: true,
  autoCapitalize: "sentences",
});

const name = Object.freeze({
  autoCorrect: "off",
  spellCheck: false,
  autoCapitalize: "words",
});

const identifier = Object.freeze({
  autoCorrect: "off",
  spellCheck: false,
  autoCapitalize: "none",
});

const search = Object.freeze({
  autoCorrect: "off",
  spellCheck: false,
  autoCapitalize: "none",
});

/**
 * Native browser and device-keyboard hints for semantic text fields.
 * Spread one policy onto an input or textarea; the device remains responsible
 * for applying the user's own keyboard and autocorrection preferences.
 */
const TEXT_ENTRY_POLICIES = Object.freeze({
  narrative,
  name,
  identifier,
  search,
});

export function textEntryProps(kind) {
  const policy = TEXT_ENTRY_POLICIES[kind];
  if (!policy) {
    throw new TypeError(`Unknown text-entry policy: ${String(kind)}`);
  }
  return policy;
}
