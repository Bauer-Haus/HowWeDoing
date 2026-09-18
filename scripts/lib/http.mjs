/**
 * HTTP helper for the data fetchers.
 *
 * Distinguishes three failure modes that need different responses from the
 * operator: an egress policy denial (the host is not reachable from this
 * environment at all), a missing or rejected API key, and a transient server
 * error (worth retrying).
 */

export class EgressBlocked extends Error {
  constructor(host) {
    super(
      `Cannot reach ${host}: blocked by the network egress policy.\n` +
      `  This environment's proxy denies CONNECT to this host, so no amount of retrying will help.\n` +
      `  Remedy: add ${host} to the allowed hosts for this environment's network policy,\n` +
      `  or run this fetcher somewhere with open outbound HTTPS and commit the updated data/*.json.`
    );
    this.name = 'EgressBlocked';
    this.host = host;
  }
}

/** The endpoint answered, but it wants credentials this run does not have. */
export class MissingKey extends Error {
  constructor(service, signupUrl, envVar) {
    super(
      `${service} rejected the request because no API key was supplied.\n` +
      `  Get a free key at ${signupUrl} and set ${envVar}.`
    );
    this.name = 'MissingKey';
  }
}

export class ApiError extends Error {
  constructor(msg, status) {
    super(msg);
    this.name = 'ApiError';
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when the failure looks like a proxy/policy denial rather than a server fault. */
function isEgressDenial(err, status) {
  if (status === 403 || status === 407) return true;
  const s = String(err && (err.cause?.message || err.message) || '').toLowerCase();
  return s.includes('tunnel') || s.includes('proxy') || s.includes('econnrefused') || s.includes('enotfound');
}

/**
 * Request a URL and parse JSON, retrying transient failures with exponential
 * backoff. Throws EgressBlocked for policy denials so callers can report them
 * clearly. Pass `body` to POST (the BLS v2 API takes a JSON body).
 */
export async function getJson(url, { attempts = 4, timeoutMs = 45000, label = '', body = null } = {}) {
  const host = new URL(url).host;
  let lastErr;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        method: body ? 'POST' : 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'how-we-doing-data-fetcher',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      clearTimeout(timer);

      if (res.status === 403 || res.status === 407) throw new EgressBlocked(host);
      if (res.status === 429 || res.status >= 500) {
        throw new ApiError(`${label || host} returned HTTP ${res.status}`, res.status);
      }
      if (!res.ok) {
        const body = (await res.text()).slice(0, 400);
        throw new ApiError(`${label || host} returned HTTP ${res.status}: ${body}`, res.status);
      }

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        /* The Census API answers a keyless request with an HTML "Missing Key"
           page rather than a 401, so the body has to be inspected. */
        if (/missing\s*key|invalid\s*key|api[_\s-]?key/i.test(text.slice(0, 600))) {
          const err = new ApiError(`${label || host} requires an API key`);
          err.missingKey = true;
          throw err;
        }
        throw new ApiError(`${label || host} returned a non-JSON body: ${text.slice(0, 300)}`);
      }
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof EgressBlocked) throw err;
      if (isEgressDenial(err, err.status)) throw new EgressBlocked(host);
      lastErr = err;
      const retryable = err instanceof ApiError ? (err.status === 429 || err.status >= 500) : true;
      if (!retryable || attempt === attempts) break;
      const wait = 2000 * 2 ** (attempt - 1);
      console.error(`  ${label || host}: ${err.message} — retrying in ${wait / 1000}s (${attempt}/${attempts - 1})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** BEA and Census both return numbers as strings, sometimes with commas or suppression codes. */
export function num(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === '(NA)' || s === '(D)' || s === '(L)' || s === 'null') return null;
  // Census uses large negative sentinels (-666666666) for unavailable estimates.
  const v = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(v) || v <= -666666666) return null;
  return v;
}
