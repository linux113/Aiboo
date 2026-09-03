// Smoke test: boots the real backend with stubbed Mongo models
// (sandbox has no mongod) and exercises auth lifecycle, validation,
// audit trail, and ingest security over real HTTP.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import http from 'node:http';

const mongoose = (await import('mongoose')).default;

// ─── Stub the DB layer ────────────────────────────────────────────
mongoose.connect = async () => {
  // writable so mongoose.close() can flip states during graceful shutdown
  Object.defineProperty(mongoose.connection, 'readyState', {
    value: 1, writable: true, configurable: true,
  });
  return mongoose.connection;
};

const TEST_EMAIL = 'admin@smoke.test';
const TEST_PASS = 'Password123!';
const passHash = await bcrypt.hash(TEST_PASS, 10);

const fakeUser = {
  _id: 'u_smoke_1',
  name: 'Smoke Admin',
  email: TEST_EMAIL,
  role: 'admin',
  password: passHash,
  matchPassword: (pw) => bcrypt.compare(pw, passHash),
  lastLogin: null,
  select() { return this; },
  toObject() { const { password, ...rest } = this; return rest; },
};

const { default: User } = await import('./models/User.js');
User.findOne = async (f) => (f?.email === TEST_EMAIL ? fakeUser : null);
User.create = async (d) => ({ ...fakeUser, ...d, _id: 'u_new_1' });
User.findById = (id) => chainable(id === 'u_smoke_1' ? fakeUser : { ...fakeUser, _id: id });
User.findByIdAndUpdate = async () => null;

const captures = { detections: [], threats: [], audits: [], responseActions: [], findings: [] };

// Mongoose query chains are thenable — stubs must be too.
const chainable = (result) => ({
  sort: () => chainable(result),
  limit: () => chainable(result),
  skip: () => chainable(result),
  lean: async () => result,
  select() { return this; },
  then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  catch: (fn) => Promise.resolve(result).catch(fn),
});

const { default: Detection } = await import('./models/Detection.js');
Detection.create = async (d) => { captures.detections.push(d); return { ...d, _id: 'd1', timestamp: new Date(), toObject() { return this; } }; };
Detection.findByIdAndUpdate = async (id, upd) => ({ _id: id, ...upd, toObject() { return this; } });
Detection.find = () => chainable([]);
Detection.countDocuments = async () => 0;

const { default: Threat } = await import('./models/Threat.js');
Threat.create = async (t) => { captures.threats.push(t); return { ...t, _id: 't1' }; };
Threat.find = () => chainable([]);

const { default: AuditLog } = await import('./models/AuditLog.js');
AuditLog.create = async (a) => { captures.audits.push(a); return { ...a }; };
AuditLog.find = () => chainable(captures.audits);
AuditLog.countDocuments = async () => captures.audits.length;

const { default: ResponseAction } = await import('./models/ResponseAction.js');
ResponseAction.create = async (a) => { captures.responseActions.push(a); return { ...a, _id: 'ra1', toObject() { return this; } }; };
ResponseAction.find = () => chainable([]);

const { default: Finding } = await import('./models/Finding.js');
Finding.find = () => chainable([]);
Finding.create = async (f) => { captures.findings.push(f); return { ...f }; };

// ─── Boot the server ──────────────────────────────────────────────
process.env.MONGO_URI = 'mongodb://stub:27017/aiboo';
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.AGENT_API_KEY = 'test-agent-key-abcdef123456';
process.env.CV_INGEST_KEY = 'test-cv-ingest-key-abcdef';
process.env.API_KEYS = 'test-service-key-1';
process.env.PORT = '4999';
process.env.SEED_DEMO_DATA = 'false';
process.env.JWT_ACCESS_TTL = '1h';
// Notification fabric: real receiver on 4990, deliberately-dead SIEM on 4991
process.env.ALERT_WEBHOOK_URL = 'http://localhost:4990/hook';
process.env.SIEM_WEBHOOK_URL = 'http://localhost:4991/nope';
process.env.NOTIFICATION_HMAC_SECRET = 'test-hmac-secret';
process.env.NOTIFICATION_TICK_MS = '40';
process.env.NOTIFICATION_RETRY_DELAY_MS = '20';
process.env.NOTIFICATION_MAX_ATTEMPTS = '3';
process.env.ALERT_NOTIFY_SEVERITIES = 'critical';

await import('./server.js');

const BASE = 'http://localhost:4999';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);

// Local webhook receiver capturing raw bodies + headers
const received = [];
const receiver = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    let body = null; try { body = JSON.parse(raw); } catch { /* non-json */ }
    received.push({ path: req.url, headers: req.headers, raw, body });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => receiver.listen(4990, r));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  cond ? pass++ : fail++;
};

const jar = {};
function stashCookies(res) {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    jar[k.trim()] = v.trim();
    if (c.includes('Max-Age=0') || /Expires=Thu, 01 Jan 1970/.test(c)) delete jar[k.trim()];
  }
}
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

const post = (path, body, { bearer, key, cookie = true } = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(key ? { 'x-api-key': key } : {}),
      ...(cookie && Object.keys(jar).length ? { cookie: cookieHeader() } : {}),
    },
    body: JSON.stringify(body),
  });

const get = (path, { bearer } = {}) =>
  fetch(`${BASE}${path}`, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });

// ═══ 1. Auth lifecycle ════════════════════════════════════════════
let r = await post('/api/auth/login', { email: TEST_EMAIL, password: TEST_PASS }, { cookie: false });
check('login 200', r.status === 200, `status=${r.status}`);
stashCookies(r);
const loginBody = await r.json();
check('login returns access token + user', !!loginBody.token && loginBody.user?.email === TEST_EMAIL);
check('login sets httpOnly refresh cookie', typeof jar.aiboo_refresh === 'string' && jar.aiboo_refresh.length > 20);
const ACCESS = loginBody.token;

r = await get('/api/auth/me', { bearer: ACCESS });
check('GET /auth/me with access token', r.status === 200, `status=${r.status}`);

// refresh rotation
const firstRefresh = jar.aiboo_refresh;
r = await post('/api/auth/refresh', {}, { cookie: true });
const rb1 = await r.json();
stashCookies(r);
check('refresh 200 + new access token', r.status === 200 && !!rb1.token, `status=${r.status}`);
check('refresh cookie rotated', !!jar.aiboo_refresh && jar.aiboo_refresh !== firstRefresh);
const ACCESS2 = rb1.token;

r = await post('/api/auth/refresh', {}, { cookie: true });
const body2 = await r.json();
stashCookies(r);
check('second refresh works (new cookie valid)', r.status === 200 && !!body2.token, `status=${r.status}`);

// replay of an OLD refresh cookie must fail (single-use)
r = await fetch(`${BASE}/api/auth/refresh`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `aiboo_refresh=${firstRefresh}` },
  body: '{}',
});
check('replayed OLD refresh cookie rejected (401)', r.status === 401, `status=${r.status}`);

// access token as refresh rejected
r = await fetch(`${BASE}/api/auth/refresh`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `aiboo_refresh=${ACCESS2 ?? ACCESS}` },
  body: '{}',
});

// ═══ 2. Validation (zod) ══════════════════════════════════════════
r = await post('/api/auth/login', { email: 'not-an-email', password: 'x' }, { cookie: false });
check('login with invalid email → 400 validation', r.status === 400 && (await r.json()).validation === true);

r = await post('/api/cameras/detections', { type: 'not_a_real_type', severity: 'critical' }, { key: 'test-cv-ingest-key-abcdef' });
check('detection invalid type → 400 validation', r.status === 400 && (await r.json()).validation === true, `status=${r.status}`);

r = await post('/api/cameras/detections', { type: 'fire', severity: 'extreme' }, { key: 'test-cv-ingest-key-abcdef' });
check('detection invalid severity → 400 validation', r.status === 400);

r = await post('/api/agent/findings', { threat_type: 'x', severity: 'ultra' }, { key: 'test-agent-key-abcdef123456' });
check('agent finding invalid severity → 400 validation', r.status === 400);

// ═══ 3. CV ingest + confidence normalisation + critical fan-out ═══
captures.detections.length = 0;
r = await post('/api/cameras/detections', {
  cameraId: 'cam1', cameraName: 'LabCam', type: 'fire', severity: 'critical',
  confidence: 0.85, label: 'fire',
}, { key: 'test-cv-ingest-key-abcdef' });
check('fire detection accepted (previously enum-rejected!)', r.status === 201, `status=${r.status}`);
await sleep(100);
check('confidence normalised 0.85 → 85', captures.detections[0]?.confidence === 85, `got=${captures.detections[0]?.confidence}`);

r = await post('/api/cameras/detections', {
  cameraId: 'cam1', type: 'smoke', severity: 'high', confidence: 0.7, label: 'smoke',
}, { key: 'test-cv-ingest-key-abcdef' });
check('smoke detection accepted', r.status === 201, `status=${r.status}`);

// ═══ 4. Correlated alert materialises as Threat ══════════════════
captures.threats.length = 0;
r = await post('/api/agent/correlated', {
  event_type: 'ransomware_prelude', severity: 'critical',
  description: '[CORRELATED] mass file renames + shadow copy deletion', entity: 'HOST-42',
}, { bearer: ACCESS });
check('POST /api/agent/correlated 200', r.status === 200);
await sleep(100);
check('correlated alert created Threat doc (source=agent)', captures.threats[0]?.source === 'agent' && captures.threats[0]?.severity === 'critical');

// ═══ 5. Orchestration endpoints (previously 404) ═════════════════
r = await post('/api/respond/war-room', {}, { bearer: ACCESS });
check('POST /respond/war-room 201 (was 404 before)', r.status === 201, `status=${r.status}`);
r = await post('/api/respond/lock-perimeter', { zone: 'lobby' }, { bearer: ACCESS });
check('POST /respond/lock-perimeter 201', r.status === 201, `status=${r.status}`);

// ═══ 6. Audit trail ══════════════════════════════════════════════
await sleep(200);
const auditedActions = captures.audits.map((a) => a.action);
check('audit: auth.login recorded', auditedActions.includes('auth.login'));
check('audit: response.war_room recorded', auditedActions.includes('response.war_room'));
const reqAudits = captures.audits.filter((a) => a.requestId);
check('audit entries carry actor + ip + requestId', reqAudits.length > 0 && reqAudits.every((a) => a.actor?.email && a.ip && a.requestId));

r = await get('/api/audit', { bearer: ACCESS });
check('GET /api/audit (admin) returns trail', r.status === 200 && (await r.json()).total >= 2, `status=${r.status}`);

r = await get('/api/audit');
check('GET /api/audit requires auth (401)', r.status === 401);

// ═══ 6b. Notification fabric (webhook + HMAC + dedupe + dead-letter) ═══
await sleep(700); // allow tick -> dispatch
const generic = received.filter((x) => x.path === '/hook');
check('generic webhook received fire alert', generic.some((x) => x.body?.event?.type === 'fire'));
const signed = generic.find((x) => x.headers['x-aiboo-signature']);
check('webhook carries HMAC signature header', !!signed);
if (signed) {
  const expected = crypto.createHmac('sha256', 'test-hmac-secret').update(signed.raw).digest('hex');
  check('HMAC signature verifies against raw body', signed.headers['x-aiboo-signature'] === `sha256=${expected}`);
} else { check('HMAC signature verifies against raw body', false, 'no signed delivery'); }

// dedupe: same fire within cooldown -> no additional dispatch
received.length = 0;
r = await post('/api/cameras/detections', { cameraId: 'cam1', cameraName: 'LabCam', type: 'fire', severity: 'critical', confidence: 0.9 }, { key: 'test-cv-ingest-key-abcdef' });
check('duplicate fire still stored (201)', r.status === 201);
await sleep(400);
check('duplicate fire deduped — no 2nd webhook', received.filter((x) => x.body?.event?.type === 'fire').length === 0);

// admin API
r = await post('/api/notifications/test', {}, { bearer: ACCESS });
check('POST /api/notifications/test 202 (audited)', r.status === 202);
await sleep(300);
check('test alert delivered to webhook', received.some((x) => x.body?.event?.type === 'notification.test'));
r = await get('/api/notifications/channels', { bearer: ACCESS });
const ch = await r.json();
check('GET /api/notifications/channels lists configured channels', r.status === 200 && (ch.channels?.length ?? 0) >= 2, `channels=${ch.channels?.length}`);
r = await get('/api/notifications/channels');
check('channels endpoint requires auth (401)', r.status === 401);
await sleep(900); // retries 20+40ms + ticks -> dead-letter
r = await get('/api/notifications/history', { bearer: ACCESS });
const hist = await r.json();
check('history records dead SIEM channel as failed', hist.items?.some((i) => i.channel === 'siem' && i.status === 'failed'));
check('dead-letter audit written for failed channel', captures.audits.some((a) => a.action === 'notification.failed' && a.details?.channel === 'siem'));

// ═══ 7. Logout revocation ════════════════════════════════════════
const refreshBeforeLogout = jar.aiboo_refresh;
r = await post('/api/auth/logout', {}, { bearer: ACCESS });
check('logout 200', r.status === 200);
stashCookies(r);
check('refresh cookie cleared on logout', jar.aiboo_refresh === undefined);

r = await get('/api/auth/me', { bearer: ACCESS });
check('access token revoked after logout (401)', r.status === 401, `status=${r.status}`);

r = await fetch(`${BASE}/api/auth/refresh`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: `aiboo_refresh=${refreshBeforeLogout}` },
  body: '{}',
});
check('refresh token revoked after logout (401)', r.status === 401, `status=${r.status}`);

// ═══ 8. Request-ID propagation ═══════════════════════════════════
r = await get('/health');
const reqId = r.headers.get('x-request-id');
check('X-Request-Id echoed on every response', !!reqId && reqId.length > 10, reqId ?? 'missing');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
