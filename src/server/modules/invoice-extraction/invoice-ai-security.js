const SIGNATURES = Object.freeze([
  {
    name: "role_override",
    severity: "critical",
    atlasTechnique: "AML.T0051",
    pattern: /\b(?:ignore|disregard|override|forget)\b.{0,80}\b(?:previous|prior|system|developer|original)\b.{0,40}\b(?:instruction|prompt|rule|message)s?\b/is,
  },
  {
    name: "role_delimiter",
    severity: "high",
    atlasTechnique: "AML.T0051.001",
    pattern: /(?:<\/?\s*(?:system|developer|assistant)\s*>|\[\/?INST\]|#{2,}\s*(?:system|developer|assistant)\b)/i,
  },
  {
    name: "prompt_extraction",
    severity: "high",
    atlasTechnique: "AML.T0056",
    pattern: /\b(?:reveal|repeat|print|show|return|expose)\b.{0,60}\b(?:system|developer|initial|hidden)\b.{0,30}\b(?:prompt|instruction|message)s?\b/is,
  },
  {
    name: "tool_or_approval_abuse",
    severity: "critical",
    atlasTechnique: "AML.T0051.002",
    pattern: /\b(?:call|invoke|run|use|execute|bypass|skip)\b.{0,80}\b(?:tool|function|approval|confirmation|permission|upload|delete|send)\b/is,
  },
  {
    name: "learning_poisoning",
    severity: "high",
    atlasTechnique: "AML.T0020",
    pattern: /\b(?:poison|inject|persist|remember|store|learn)\b.{0,80}\b(?:training|memory|corpus|example|rule|playbook|future)\b/is,
  },
  {
    name: "persona_jailbreak",
    severity: "high",
    atlasTechnique: "AML.T0051",
    pattern: /\b(?:developer|dan|evil|unrestricted|unfiltered)\s+(?:mode|persona)\b|\byou are now\b.{0,60}\b(?:unrestricted|unconstrained|developer|system)\b/is,
  },
  {
    name: "obfuscated_instruction",
    severity: "elevated",
    atlasTechnique: "AML.T0043",
    pattern: /\b(?:base64|rot13|decode|deobfuscate)\b.{0,80}\b(?:instruction|prompt|payload|command)\b/is,
  },
]);

const SEVERITY_SCORE = Object.freeze({ none: 0, elevated: 1, high: 2, critical: 3 });

function normalizedUntrustedText(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .slice(0, 100_000);
}

export function classifyInvoiceAiText(value, { source = "untrusted_text" } = {}) {
  const text = normalizedUntrustedText(value);
  const signatures = SIGNATURES
    .filter((signature) => signature.pattern.test(text))
    .map(({ name, severity, atlasTechnique }) => ({ name, severity, atlasTechnique }));
  const severity = signatures.reduce(
    (highest, signature) => SEVERITY_SCORE[signature.severity] > SEVERITY_SCORE[highest] ? signature.severity : highest,
    "none",
  );
  return Object.freeze({
    source: String(source || "untrusted_text").slice(0, 80),
    inputLength: text.length,
    severity,
    signatures: Object.freeze(signatures.map(Object.freeze)),
    requiresReview: SEVERITY_SCORE[severity] >= SEVERITY_SCORE.elevated,
    blockLearning: SEVERITY_SCORE[severity] >= SEVERITY_SCORE.high,
  });
}

export function classifyInvoiceAiContext(context = {}) {
  const assessments = [
    ["vendor_hint", context.vendorHint],
    ["local_ocr", context.localOcrText],
    ["native_pdf_text", context.nativeDocumentText],
    ["approved_memory", context.approvedMemoryText],
  ].map(([source, value]) => classifyInvoiceAiText(value, { source }));
  const signatures = [...new Set(assessments.flatMap((assessment) => assessment.signatures.map((entry) => entry.name)))].sort();
  const severity = assessments.reduce(
    (highest, assessment) => SEVERITY_SCORE[assessment.severity] > SEVERITY_SCORE[highest] ? assessment.severity : highest,
    "none",
  );
  return Object.freeze({
    severity,
    signatures: Object.freeze(signatures),
    sources: Object.freeze(assessments.filter((assessment) => assessment.requiresReview).map((assessment) => assessment.source)),
    requiresReview: SEVERITY_SCORE[severity] >= SEVERITY_SCORE.elevated,
    blockLearning: SEVERITY_SCORE[severity] >= SEVERITY_SCORE.high,
  });
}

export { SIGNATURES as invoiceAiInjectionSignatures };
