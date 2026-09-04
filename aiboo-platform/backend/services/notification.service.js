// backend/services/notification.service.js
// Phase 4 notification fabric: fan critical alerts out to configured channels
// with per-event dedupe, exponential-backoff retries and a dead-letter audit
// trail. Channels (all optional, all env-driven):
//
//   ALERT_WEBHOOK_URL           generic JSON webhook, HMAC-signed
//   ALERT_SLACK_WEBHOOK_URL     Slack incoming webhook
//   ALERT_PAGERDUTY_ROUTING_KEY PagerDuty Events API v2
//   SIEM_WEBHOOK_URL            CEF-formatted event forwarding (Splunk/Elastic/…)
//
// Behaviour:
//   - severity gate: ALERT_NOTIFY_SEVERITIES (default "critical")
//   - dedupe: identical type+target+severity collapsed for NOTIFICATION_DEDUPE_MS
//   - retries: NOTIFICATION_MAX_ATTEMPTS (5) with exponential backoff from
//     NOTIFICATION_RETRY_DELAY_MS (5s)
//   - exhausted retries -> AuditLog entry `notification.failed` (who/what/why)
import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { audit } from '../utils/audit.js';

const TICK_MS = parseInt(process.env.NOTIFICATION_TICK_MS || '1000', 10);
const MAX_ATTEMPTS = parseInt(process.env.NOTIFICATION_MAX_ATTEMPTS || '5', 10);
const BASE_DELAY = parseInt(process.env.NOTIFICATION_RETRY_DELAY_MS || '5000', 10);
const DEDUPE_MS = parseInt(process.env.NOTIFICATION_DEDUPE_MS || '60000', 10);
const NOTIFY_SEVERITIES = (process.env.ALERT_NOTIFY_SEVERITIES || 'critical')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const queue = [];        // { channel, event, attempts, nextAt }
const history = [];      // last 200 dispatch records (status sent|failed)
const dedupe = new Map(); // key -> ts
const MAX_HISTORY = 200;

let timer = null;
let ticking = false;

// ── Channels ────────────────────────────────────────────────────────
export function getChannels() {
  const list = [];
  if (process.env.ALERT_WEBHOOK_URL) {
    list.push({ type: 'generic', url: process.env.ALERT_WEBHOOK_URL });
  }
  if (process.env.ALERT_SLACK_WEBHOOK_URL) {
    list.push({ type: 'slack', url: process.env.ALERT_SLACK_WEBHOOK_URL });
  }
  if (process.env.ALERT_PAGERDUTY_ROUTING_KEY) {
    list.push({ type: 'pagerduty', routingKey: process.env.ALERT_PAGERDUTY_ROUTING_KEY });
  }
  if (process.env.SIEM_WEBHOOK_URL) {
    list.push({ type: 'siem', url: process.env.SIEM_WEBHOOK_URL });
  }
  return list;
}

const maskUrl = (u) => {
  try { return new URL(u).host; } catch { return 'invalid-url'; }
};

export function getChannelsStatus() {
  return getChannels().map((c) => ({
    type: c.type,
    target: c.url ? maskUrl(c.url) : 'pagerduty.com',
    configured: true,
  }));
}

export function getHistory(limit = 50) {
  return history.slice(-Math.min(limit, MAX_HISTORY)).reverse();
}

export function getQueueDepth() {
  return queue.length;
}

// ── Public API ──────────────────────────────────────────────────────
export function notifyCritical(event, { force = false } = {}) {
  try {
    const severity = String(event?.severity || 'critical').toLowerCase();
    if (!force && !NOTIFY_SEVERITIES.includes(severity)) return;

    const key = `${event?.type || 'unknown'}:${event?.cameraId ?? event?.entity ?? ''}:${severity}`;
    if (!force) {
      const now = Date.now();
      const last = dedupe.get(key);
      if (last && now - last < DEDUPE_MS) {
        logger.debug(`Notification deduped: ${key}`);
        return;
      }
      dedupe.set(key, now);
    }

    const channels = getChannels();
    if (channels.length === 0) return;

    for (const channel of channels) {
      queue.push({ channel, event, attempts: 0, nextAt: 0 });
    }
    ensureWorker();
    logger.info(`Alert queued to ${channels.length} channel(s): ${key}`);
  } catch (err) {
    logger.error(`notifyCritical failed: ${err.message}`);
  }
}

// ── Worker ──────────────────────────────────────────────────────────
function ensureWorker() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (let i = queue.length - 1; i >= 0; i--) {
      const item = queue[i];
      if (item.nextAt > now) continue;
      queue.splice(i, 1);
      try {
        await deliver(item);
        record('sent', item);
      } catch (err) {
        item.attempts += 1;
        if (item.attempts >= MAX_ATTEMPTS) {
          record('failed', item, err.message);
          audit(null, 'notification.failed', {
            targetType: 'notification',
            targetId: item.channel.type,
            details: {
              channel: item.channel.type,
              event: summarize(item.event),
              attempts: item.attempts,
              error: String(err.message).slice(0, 300),
            },
          });
        } else {
          item.nextAt = Date.now() + BASE_DELAY * 2 ** (item.attempts - 1);
          queue.push(item);
        }
      }
    }
  } finally {
    ticking = false;
  }
}

function record(status, item, error) {
  history.push({
    channel: item.channel.type,
    status,
    attempts: item.attempts + (status === 'sent' ? 1 : 0),
    error,
    event: summarize(item.event),
    timestamp: new Date().toISOString(),
  });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
  if (status === 'failed') {
    logger.error(`Notification to ${item.channel.type} FAILED after ${item.attempts} attempts`);
  }
}

const summarize = (event) => ({
  type: event?.type || event?.event_type || 'unknown',
  severity: event?.severity || 'critical',
  target: event?.cameraName || event?.cameraId || event?.entity || '-',
  message: String(event?.message || event?.description || '').slice(0, 140),
});

// ── Channel formatters ──────────────────────────────────────────────
const PD_SEVERITY = { critical: 'critical', high: 'error', medium: 'warning', low: 'info' };
const CEF_SEVERITY = { critical: 10, high: 7, medium: 4, low: 2 };

const cefEscape = (s) => String(s ?? '').replace(/[|\\\n\r]/g, ' ').slice(0, 200);

function toCef(event) {
  const s = summarize(event);
  const rt = Date.now();
  return (
    `CEF:0|Aiboo|SecurityPlatform|1.0|${cefEscape(s.type)}|${cefEscape(s.message || s.type)}` +
    `|${CEF_SEVERITY[s.severity] ?? 7}|rt=${rt} cs1Label=Target cs1=${cefEscape(s.target)}` +
    ` cs2Label=Severity cs2=${s.severity} cs3Label=Source cs3=aiboo-backend`
  );
}

async function deliver({ channel, event }) {
  const s = summarize(event);
  const timeout = 5000;

  if (channel.type === 'slack') {
    const icon = s.severity === 'critical' ? ':rotating_light:' : ':warning:';
    await axios.post(channel.url, {
      text: `${icon} *[${s.severity.toUpperCase()}]* ${s.type} — ${s.target}`,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `${icon} *[${s.severity.toUpperCase()}]* ${s.type} — *${s.target}*` } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: `*Severity:*\n${s.severity}` },
          { type: 'mrkdwn', text: `*Message:*\n${s.message || '-'}` },
        ] },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `AiBoO Platform · ${new Date().toISOString()}` }] },
      ],
    }, { timeout });
    return;
  }

  if (channel.type === 'pagerduty') {
    await axios.post('https://events.pagerduty.com/v2/enqueue', {
      routing_key: channel.routingKey,
      event_action: 'trigger',
      dedup_key: `${s.type}:${s.target}`.slice(0, 255),
      payload: {
        summary: `[${s.severity.toUpperCase()}] ${s.type} — ${s.target}: ${s.message || 'no message'}`.slice(0, 1024),
        source: 'aiboo-backend',
        severity: PD_SEVERITY[s.severity] || 'error',
        timestamp: new Date().toISOString(),
      },
    }, { timeout });
    return;
  }

  if (channel.type === 'siem') {
    const body = { cef: toCef(event), event };
    const data = JSON.stringify(body);
    await axios.post(channel.url, data, {
      timeout,
      headers: { 'Content-Type': 'application/json', 'X-Aiboo-Event': s.type },
    });
    return;
  }

  // generic: full event + HMAC signature header for receiver-side integrity
  const data = JSON.stringify({ event, sent_at: new Date().toISOString() });
  const headers = { 'Content-Type': 'application/json', 'X-Aiboo-Event': s.type };
  const secret = process.env.NOTIFICATION_HMAC_SECRET;
  if (secret) {
    headers['X-Aiboo-Signature'] = `sha256=${crypto.createHmac('sha256', secret).update(data).digest('hex')}`;
  }
  await axios.post(channel.url, data, { timeout, headers });
}
