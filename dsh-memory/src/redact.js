/**
 * Best-effort secret redaction for text that may enter durable memory.
 *
 * Ported from the intent of Codex's `codex-secrets::redact_secrets`: keep the
 * surrounding evidence, replace credential material with a stable marker. The
 * patterns cover common provider tokens, private-key blocks, authorization
 * headers, credential assignments, URL userinfo, and access-bearing query
 * parameters. High-entropy detection is intentionally omitted: it over-redacts
 * ordinary identifiers and would damage memory usefulness.
 */

const MARKER = "[REDACTED_SECRET]";

/** Ordered replacement rules; earlier rules protect longer markers. */
const RULES = [
  // PEM private keys (any label).
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, MARKER],

  // Authorization headers and bearer/basic credentials.
  [/(\b(?:authorization|proxy-authorization)\s*[:=]\s*)(?:bearer|basic|token)?\s*[^\s,;]+/gi, `$1${MARKER}`],
  [/(\bbearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MARKER}`],

  // Well-known token shapes.
  [/\b(sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,})/g, MARKER],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,})/g, MARKER],
  [/\b(github_pat_[A-Za-z0-9_]{20,})/g, MARKER],
  [/\b(xox[baprs]-[A-Za-z0-9-]{10,})/g, MARKER],
  [/\b(AKIA[0-9A-Z]{16})\b/g, MARKER],
  [/\b(ASIA[0-9A-Z]{16})\b/g, MARKER],
  [/\b(AIza[0-9A-Za-z_-]{30,})/g, MARKER],
  [/\b(glpat-[A-Za-z0-9_-]{20,})/g, MARKER],
  [/\b(npm_[A-Za-z0-9]{20,})/g, MARKER],
  [/\b(hf_[A-Za-z0-9]{20,})/g, MARKER],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g, MARKER],

  // Credential assignments in env/TOML/JSON/YAML/CLI forms.
  [/((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key|password|passwd|pwd|secret)\s*[:=]\s*["']?)[^\s"',;}]{4,}/gi, `$1${MARKER}`],

  // URL userinfo and access-bearing query parameters.
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MARKER}@`],
  [/([?&](?:token|access_token|refresh_token|api_key|apikey|key|secret|password|signature|sig|auth|code)=)[^&#\s]+/gi, `$1${MARKER}`],
];

/**
 * Replace credential material while preserving context.
 *
 * @param value - text that may be stored or sent to a model.
 * @returns the redacted text; non-strings pass through unchanged.
 */
export function redactSecrets(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  let output = value;
  for (const [pattern, replacement] of RULES) output = output.replace(pattern, replacement);
  return output;
}

export { MARKER };
