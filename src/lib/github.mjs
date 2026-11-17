/**
 * A tiny GitHub REST client that is polite by default.
 *
 * - Conditional requests (ETag / If-None-Match). RivalMode polls the same
 *   endpoints hourly, so cached 304s are what keeps it inside the free tier.
 * - Secondary rate limits are respected via Retry-After / X-RateLimit-Reset.
 * - Every failure is a typed GithubError so callers can degrade gracefully
 *   instead of crashing the whole README generation.
 */
import fs from 'node:fs';
import path from 'node:path';

export class GithubError extends Error {
  constructor(message, { status = 0, url = '', body = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
    this.url = url;
    this.body = body;
    this.retryAfter = retryAfter;
  }

  /** Errors we can paper over with an empty list + a warning in the README. */
  get soft() {
    return this.status === 0 || this.status === 403 || this.status === 404 || this.status === 422 || this.status === 451;
  }
}

const API = 'https://api.github.com';
const UA = 'rivalmode/1 (+https://github.com/pooria683/rivalmode)';

export class GithubClient {
  constructor({
    token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
    apiBase = API,
    cacheFile = null,
    ttl = 60 * 1000,
    maxRetries = 3,
    logger = console,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {}) {
    this.token = token || '';
    this.apiBase = apiBase.replace(/\/$/, '');
    this.ttl = ttl;
    this.maxRetries = maxRetries;
    this.logger = logger;
    this.fetch = fetchImpl;
    this.now = now;
    this.sleep = sleep;
    this.cacheDir = cacheFile;
    this.cache = cacheFile ? loadCache(cacheFile) : {};
    this.calls = 0;
    this.cacheHits = 0;
    this.remaining = null;
    this.resetAt = null;
    this.budgets = {};
    this.warnings = new Set();
    this.dirty = false;
  }

  get authenticated() {
    return Boolean(this.token);
  }

  warn(message) {
    if (this.warnings.has(message)) return;
    this.warnings.add(message);
    this.logger.warn?.(`[rivalmode] ${message}`);
  }

  /** GET returning parsed JSON, `null` on 404, and throwing GithubError otherwise. */
  async get(pathname, { query = {}, raw = false, ttl = this.ttl, allow404 = true, accept } = {}) {
    const { body, response } = await this.request(pathname, { query, ttl, allow404, accept });
    if (body === null) return null;
    return raw ? { body, response } : body;
  }

  /**
   * Core request. Returns `{ body, response }` where body is `null` for
   * 404s and unchanged-cache responses are served from disk.
   */
  async request(pathname, { query = {}, ttl = this.ttl, allow404 = true, accept } = {}) {
    const url = this.buildUrl(pathname, query);
    const cached = this.cache[url];
    const fresh = cached && this.now() - cached.at < ttl;
    if (fresh) {
      this.cacheHits += 1;
      return { body: cached.body, response: { status: 200, headers: new Headers(cached.headers || {}) }, cached: true };
    }

    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const headers = {
        accept: accept || 'application/vnd.github+json',
        'user-agent': UA,
        'x-github-api-version': '2022-11-28',
      };
      if (this.token) headers.authorization = `Bearer ${this.token}`;
      if (cached?.etag) headers['if-none-match'] = cached.etag;

      this.calls += 1;
      let res;
      try {
        res = await this.fetch(url, { headers });
      } catch (err) {
        lastError = new GithubError(`network error: ${err.message}`, { url });
        await this.sleep(backoff(attempt));
        continue;
      }

      this.trackRateLimit(res.headers);

      if (res.status === 304 && cached) {
        this.cacheHits += 1;
        this.cache[url] = { ...cached, at: this.now() };
        this.dirty = true;
        return { body: cached.body, response: res, cached: true };
      }

      if (res.status === 404) {
        if (allow404) return { body: null, response: res };
        // Unauthenticated requests get a 404 (not a 403) once the hourly quota
        // is gone, so say so instead of "not found".
        const hint = this.authenticated ? '' : ' (no token: GitHub returns 404 when the unauthenticated rate limit is exhausted)';
        throw new GithubError(`404 for ${url}${hint}`, { status: 404, url });
      }

      if (res.status === 401) {
        throw new GithubError(
          'GitHub rejected the token (401). Check GITHUB_TOKEN permissions (contents: write, issues: write, pull-requests: read).',
          { status: 401, url }
        );
      }

      if (res.status === 403 || res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after')) || null;
        const rateReset = Number(res.headers.get('x-ratelimit-reset')) || null;
        const exhausted = res.headers.get('x-ratelimit-remaining') === '0';
        const body = await safeText(res);
        const secondary = /secondary rate limit|abuse|rate limit/i.test(body);
        // GitHub sometimes spells the wait out in prose instead of Retry-After.
        const proseWait = Number((body.match(/try again in (\d+) (second|minute)/i) || [])[1]);
        const proseUnit = (body.match(/try again in \d+ (second|minute)/i) || [])[1];
        if (attempt < this.maxRetries && (exhausted || secondary)) {
          const waitMs = retryAfter
            ? retryAfter * 1000
            : proseWait
              ? proseWait * (proseUnit === 'minute' ? 60000 : 1000)
              : rateReset
                ? Math.max(1000, rateReset * 1000 - this.now())
                : backoff(attempt);
          // Never sit in a runner for more than a couple of minutes: degrade instead.
          if (waitMs < 120 * 1000) {
            this.logger.warn?.(`[rivalmode] rate limited on ${url}; waiting ${Math.round(waitMs / 1000)}s`);
            await this.sleep(waitMs);
            continue;
          }
          this.warn(`rate limited on ${new URL(url).pathname} — skipping it this run`);
        } else if (exhausted) {
          this.warn(`rate limit exhausted for ${new URL(url).pathname} — skipping it this run`);
        }
        throw new GithubError(`403 for ${url} (${exhausted ? 'rate limit exhausted' : 'forbidden'})`, {
          status: 403,
          url,
          retryAfter,
        });
      }

      if (res.status >= 500) {
        lastError = new GithubError(`${res.status} for ${url}`, { status: res.status, url });
        if (attempt < this.maxRetries) {
          await this.sleep(backoff(attempt));
          continue;
        }
        throw lastError;
      }

      if (!res.ok) {
        throw new GithubError(`${res.status} for ${url}`, { status: res.status, url, body: await safeText(res) });
      }

      const text = await res.text();
      let body;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        throw new GithubError(`invalid JSON from ${url}`, { status: res.status, url, body: text.slice(0, 300) });
      }

      const etag = res.headers.get('etag');
      const headersOut = {};
      res.headers.forEach((value, key) => {
        if (key === 'etag' || key === 'last-modified') headersOut[key] = value;
      });
      this.cache[url] = { at: this.now(), etag, body, headers: headersOut };
      this.dirty = true;
      return { body, response: res };
    }

    throw lastError ?? new GithubError(`request failed for ${url}`, { url });
  }

  /** GET with pagination (per_page=100 by default), following Link headers. */
  async paginate(pathname, { query = {}, maxPages = 3, perPage = 100, ttl = this.ttl } = {}) {
    const items = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const { body, response } = await this.request(pathname, { query: { ...query, per_page: perPage, page }, ttl });
      if (!Array.isArray(body)) break;
      items.push(...body);
      const link = response.headers?.get?.('link') || '';
      if (!body.length || !/rel="next"/.test(link) || body.length < perPage) break;
    }
    return items;
  }

  /** GraphQL is only used for the contributor leaderboard (REST can't sort it). */
  async graphql(query, variables = {}) {
    const url = this.apiBase.replace(/\/api\/v3$/, '') + (this.apiBase.includes('api.github.com') ? '/graphql' : '/graphql');
    const res = await this.fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': UA,
        ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
    this.calls += 1;
    if (!res.ok) throw new GithubError(`GraphQL ${res.status}`, { status: res.status, url, body: await safeText(res) });
    const json = await res.json();
    if (json.errors?.length) {
      throw new GithubError(`GraphQL: ${json.errors.map((e) => e.message).join('; ')}`, { status: 200, url, body: json });
    }
    return json.data;
  }

  buildUrl(pathname, query = {}) {
    const clean = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const url = new URL(this.apiBase + clean);
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    // Stable key order keeps the cache file diff-friendly.
    url.searchParams.sort();
    return url.toString();
  }

  /** GitHub budgets core, search and graphql separately — track the tightest. */
  trackRateLimit(headers) {
    const remaining = headers.get?.('x-ratelimit-remaining');
    const reset = headers.get?.('x-ratelimit-reset');
    const resource = headers.get?.('x-ratelimit-resource') || 'core';
    if (remaining == null) return;
    this.budgets[resource] = { remaining: Number(remaining), resetAt: reset ? Number(reset) * 1000 : null };
    this.remaining = Number(remaining);
    this.resetAt = reset ? Number(reset) * 1000 : null;
    const floor = resource === 'search' ? 2 : 20;
    if (this.remaining <= floor) {
      this.warn(`GitHub ${resource} budget low (${this.remaining} left)`);
    }
  }

  /** True when the given resource has no budget left for this window. */
  exhausted(resource = 'core') {
    const budget = this.budgets[resource];
    return Boolean(budget && budget.remaining <= 0 && budget.resetAt && budget.resetAt > this.now());
  }

  /** Persist ETags. Called automatically by the CLI at the end of a run. */
  saveCache() {
    if (!this.cacheDir || !this.dirty) return;
    const keep = {};
    const cutoff = this.now() - 14 * 24 * 60 * 60 * 1000;
    for (const [url, entry] of Object.entries(this.cache)) {
      if (entry.at >= cutoff) keep[url] = entry;
    }
    fs.mkdirSync(path.dirname(this.cacheDir), { recursive: true });
    fs.writeFileSync(this.cacheDir, `${JSON.stringify(keep)}\n`);
    this.dirty = false;
  }

  stats() {
    return {
      calls: this.calls,
      cacheHits: this.cacheHits,
      remaining: this.remaining,
      resetAt: this.resetAt,
      budgets: { ...this.budgets },
      searchExhausted: this.exhausted('search'),
    };
  }
}

function loadCache(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    /* a corrupt cache is never worth failing a run over */
  }
  return {};
}

function backoff(attempt) {
  return Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

async function safeText(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/** Normalise anything our client can throw into a readable warning. */
export function describeError(err) {
  if (err instanceof GithubError) {
    if (err.status === 403) return 'GitHub rate limit reached — showing last known numbers';
    if (err.status === 404) return 'Not found or not readable (private repo, missing permission, or unauthenticated rate limit)';
    if (err.status === 401) return 'GitHub token rejected';
    return err.message;
  }
  return err?.message || String(err);
}
