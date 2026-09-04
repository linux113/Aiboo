// backend/services/intel.service.js
// Threat-intelligence enrichment for findings/detections.
//
// Sources (each optional — enable by setting its key):
//   ABUSEIPDB_API_KEY        ip reputation (abuse confidence, ISP, usage)
//   VIRUSTOTAL_API_KEY       ip + file-hash reputation
//   MISP_URL + MISP_API_KEY  self-hosted MISP attribute search
// Base URLs are env-overridable (ABUSEIPDB_URL / VIRUSTOTAL_URL / MISP_URL)
// so self-hosted/proxied deployments and tests work without code changes.
//
// Behaviour: TTL cache (default 6h) per indicator; failures degrade to
// verdict 'unknown' with a short negative-TTL so a dead feed never blocks
// or spams. Fire-and-forget enrichment never blocks ingestion.
import axios from 'axios';
import logger from '../utils/logger.js';

const CACHE_TTL = parseInt(process.env.INTEL_CACHE_TTL_MS || `${6 * 60 * 60 * 1000}`, 10);
const NEG_TTL = parseInt(process.env.INTEL_NEGATIVE_TTL_MS || `${10 * 60 * 1000}`, 10);
const CACHE_MAX = parseInt(process.env.INTEL_CACHE_MAX || '1000', 10);
const TIMEOUT = parseInt(process.env.INTEL_TIMEOUT_MS || '4000', 10);

const cache = new Map(); // key -> { value, expiresAt }

const cacheGet = (k) => {
  const hit = cache.get(k);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) { cache.delete(k); return null; }
  return hit.value;
};
const cacheSet = (k, v, ttl) => {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(k, { value: v, expiresAt: Date.now() + ttl });
};

export function intelStatus() {
  return {
    enabled: Boolean(
      process.env.ABUSEIPDB_API_KEY || process.env.VIRUSTOTAL_API_KEY || process.env.MISP_API_KEY
    ),
    sources: {
      abuseipdb: Boolean(process.env.ABUSEIPDB_API_KEY),
      virustotal: Boolean(process.env.VIRUSTOTAL_API_KEY),
      misp: Boolean(process.env.MISP_API_KEY && process.env.MISP_URL),
    },
    cacheEntries: cache.size,
  };
}

// ── Individual sources ─────────────────────────────────────────────
async function abuseipdb(ip) {
  if (!process.env.ABUSEIPDB_API_KEY) return null;
  const base = process.env.ABUSEIPDB_URL || 'https://api.abuseipdb.net/api/v2';
  const res = await axios.get(`${base}/check`, {
    params: { ipAddress: ip, maxAgeInDays: 30 },
    headers: { Key: process.env.ABUSEIPDB_API_KEY, Accept: 'application/json' },
    timeout: TIMEOUT,
  });
  const d = res.data?.data ?? {};
  const score = d.abuseConfidenceScore ?? 0;
  return {
    source: 'abuseipdb',
    verdict: score >= 50 ? 'malicious' : score > 0 ? 'suspicious' : 'clean',
    score,
    detail: [d.isp, d.usageType, d.countryCode].filter(Boolean).join(' · ') || undefined,
  };
}

async function virustotal(kind, value) {
  if (!process.env.VIRUSTOTAL_API_KEY) return null;
  const base = process.env.VIRUSTOTAL_URL || 'https://www.virustotal.com/api/v3';
  const path = kind === 'hash' ? `files/${value}` : `ip_addresses/${value}`;
  const res = await axios.get(`${base}/${path}`, {
    headers: { 'x-apikey': process.env.VIRUSTOTAL_API_KEY },
    timeout: TIMEOUT,
  });
  const stats = res.data?.data?.attributes?.last_analysis_stats ?? {};
  const malicious = (stats.malicious ?? 0) + (stats.suspicious ?? 0);
  return {
    source: 'virustotal',
    verdict: malicious > 0 ? 'malicious' : 'clean',
    score: malicious,
    detail: `malicious:${stats.malicious ?? 0} suspicious:${stats.suspicious ?? 0}`,
  };
}

async function misp(value) {
  if (!process.env.MISP_API_KEY || !process.env.MISP_URL) return null;
  const res = await axios.post(
    `${process.env.MISP_URL.replace(/\/$/, '')}/attributes/restSearch`,
    { value, 'publish_timestamp': 7776000 }, // last 90d
    { headers: { Authorization: process.env.MISP_API_KEY, Accept: 'application/json' }, timeout: TIMEOUT }
  );
  const attrs = res.data?.response?.Attribute ?? [];
  return {
    source: 'misp',
    verdict: attrs.length > 0 ? 'malicious' : 'clean',
    score: attrs.length,
    detail: attrs.slice(0, 3).map((a) => `${a.type}:${a.Event?.info ?? ''}`).join(' · ') || undefined,
  };
}

// ── Public lookups (cached, multi-source) ──────────────────────────
async function lookup(kind, value) {
  const key = `${kind}:${value}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const results = [];
  await Promise.allSettled([
    (async () => { try { const r = await abuseipdb(value); if (r) results.push(r); } catch (e) { results.push({ source: 'abuseipdb', verdict: 'unknown', error: e.message.slice(0, 120) }); } })(),
    (async () => { try { const r = await virustotal(kind, value); if (r) results.push(r); } catch (e) { results.push({ source: 'virustotal', verdict: 'unknown', error: e.message.slice(0, 120) }); } })(),
    (async () => { try { const r = await misp(value); if (r) results.push(r); } catch (e) { results.push({ source: 'misp', verdict: 'unknown', error: e.message.slice(0, 120) }); } })(),
  ]);

  const overall = results.some((r) => r.verdict === 'malicious')
    ? 'malicious'
    : results.some((r) => r.verdict === 'suspicious')
      ? 'suspicious'
      : results.every((r) => r.verdict === 'unknown')
        ? 'unknown'
        : 'clean';

  const value_ = { indicator: value, type: kind, overall, results, lookedUpAt: new Date().toISOString() };
  cacheSet(key, value_, overall === 'unknown' ? NEG_TTL : CACHE_TTL);
  return value_;
}

export const lookupIp = (ip) => lookup('ip', ip);
export const lookupHash = (hash) => lookup('hash', hash);

// ── IoC extraction ─────────────────────────────────────────────────
const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const SHA256_RE = /\b[0-9a-f]{64}\b/gi;
const SHA1_RE = /\b[0-9a-f]{40}\b/gi;
const MD5_RE = /\b[0-9a-f]{32}\b/gi;

const PRIVATE_IP = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|255\.)/;

/** Extract public IoCs from arbitrary text/metadata. Deduped, capped. */
export function extractIoCs(input) {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? {});
  const ips = [...new Set((text.match(IPV4_RE) ?? []))].filter((ip) => !PRIVATE_IP.test(ip));
  const sha256 = [...new Set((text.match(SHA256_RE) ?? []))];
  const others = [...new Set([...(text.match(SHA1_RE) ?? []), ...(text.match(MD5_RE) ?? [])])];
  const iocs = [
    ...ips.slice(0, 5).map((v) => ({ type: 'ip', value: v })),
    ...sha256.slice(0, 3).map((v) => ({ type: 'hash', value: v.toLowerCase() })),
    ...others.slice(0, 3).map((v) => ({ type: 'hash', value: v.toLowerCase() })),
  ];
  return iocs.slice(0, 8);
}

/**
 * Enrich a finding/detection object: extract IoCs, look them up (cached),
 * return { iocs, intel } — caller merges into metadata. Never throws.
 */
export async function enrich(payload) {
  try {
    if (!intelStatus().enabled) return { iocs: extractIoCs(payload), intel: { enabled: false } };
    const iocs = extractIoCs({ summary: payload?.summary, metadata: payload?.metadata, description: payload?.description });
    const intel = {};
    for (const ioc of iocs) {
      intel[`${ioc.type}:${ioc.value}`] = await (ioc.type === 'ip' ? lookupIp(ioc.value) : lookupHash(ioc.value));
    }
    return { iocs, intel };
  } catch (err) {
    logger.warn(`Intel enrichment failed: ${err.message}`);
    return { iocs: [], intel: { error: err.message } };
  }
}
