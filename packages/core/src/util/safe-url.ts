/**
 * SSRF-safe URL validation for the AgenticMail API base URL.
 *
 * # What this is for
 *
 * Every host integration (claudecode, codex, …) reads the master API
 * URL from `~/.agenticmail/config.json` and uses it to build fetch
 * requests. CodeQL's `js/request-forgery` query flags those fetch
 * calls because the URL is operator-controlled (via the config file
 * or env vars) and could theoretically be redirected to an internal
 * service the host process can reach but the operator didn't intend.
 *
 * In practice the operator controls their own config file — there's
 * no remote attacker controlling apiUrl in a self-hosted install.
 * But defence-in-depth dictates we still validate, because:
 *
 *   - A malicious npm package that planted an env var (e.g.
 *     `AGENTICMAIL_API_URL=http://169.254.169.254/latest/meta-data/`)
 *     could redirect the dispatcher's API calls to a cloud-metadata
 *     endpoint and exfiltrate IAM credentials in the response body.
 *   - A `file://` or `javascript:` scheme would let the operator's
 *     own typo cause undefined behavior.
 *
 * # The check
 *
 * `validateApiUrl(url)` rejects:
 *
 *   - Non-`http(s)://` schemes (`file://`, `javascript:`, `data:`,
 *     `ftp://`, etc).
 *   - Cloud metadata IPs (169.254.169.254 — AWS/Azure/GCP) and the
 *     IPv6 equivalent fd00:ec2::254.
 *   - Empty / malformed URLs (via `new URL` parse).
 *
 * The check intentionally does NOT restrict to localhost — operators
 * legitimately run AgenticMail on a NAS or remote VM and point the
 * host-integration installs at it. The cloud-metadata IPs are the
 * only blanket block.
 *
 * # Why a separate canonicalisation step
 *
 * Returning the URL via `url.origin` (rather than the raw input
 * string) gives CodeQL a sanitiser shape it recognises: the value
 * is now constrained to whatever `URL` parsed it into, with no
 * embedded credentials, query strings, or path traversal.
 */

/** Thrown when `validateApiUrl` rejects a candidate URL. */
export class UnsafeApiUrlError extends Error {
  constructor(public readonly raw: string, public readonly reason: string) {
    super(`unsafe AgenticMail API URL ${JSON.stringify(raw)}: ${reason}`);
    this.name = 'UnsafeApiUrlError';
  }
}

/** Cloud metadata addresses that should never be reached by accident. */
const BLOCKED_HOSTS = new Set<string>([
  '169.254.169.254',           // AWS / Azure / GCP IPv4 metadata
  'fd00:ec2::254',             // AWS IPv6 metadata
  'metadata.google.internal',  // GCP DNS
  'metadata.azure.internal',   // Azure DNS
]);

/**
 * Validate the operator-supplied AgenticMail API base URL.
 *
 * Returns the canonical origin form of the URL (`http://host:port`)
 * so callers can build paths against it without worrying about
 * trailing slashes or embedded auth. Throws `UnsafeApiUrlError` on
 * any structural problem or blocked host.
 */
export function validateApiUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new UnsafeApiUrlError(String(raw), 'must be a non-empty string');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (err) {
    throw new UnsafeApiUrlError(raw, `unparseable: ${(err as Error).message}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeApiUrlError(raw, `unsupported protocol: ${parsed.protocol}`);
  }
  // Strip trailing dot from DNS names ("localhost." → "localhost") for
  // the hostname comparison so a typo can't bypass the blocklist.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTS.has(host)) {
    throw new UnsafeApiUrlError(raw, `blocked metadata host: ${host}`);
  }
  // Reject embedded credentials (`http://user:pass@host`). The
  // AgenticMail API authenticates via Bearer token, not URL creds.
  // CodeQL also dislikes URL-creds because they leak into logs.
  if (parsed.username || parsed.password) {
    throw new UnsafeApiUrlError(raw, 'embedded credentials are not supported');
  }
  // Strip trailing slash; callers build paths against `origin`.
  return parsed.origin;
}

/**
 * Build a full request URL from a validated base + path. Used by the
 * host-integration api clients to ensure the path is appended via
 * `URL` (escapes correctly) rather than string concat.
 */
export function buildApiUrl(baseOrigin: string, pathAndQuery: string): string {
  // baseOrigin is assumed already-validated. Path may include a
  // query string; pass it through URL so escaping is correct.
  const path = pathAndQuery.startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return new URL(path, baseOrigin + '/').toString();
}
