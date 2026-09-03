// Smoke test: boots the real backend with a stubbed Mongo connection
// (sandbox has no mongod) and exercises the new security + ingest paths
// end-to-end over real HTTP.
const mongoose = (await import('mongoose')).default;

// --- Stub the DB: connect resolves, connection pretends to be ready ---
const origConnect = mongoose.connect.bind(mongoose);
mongoose.connect = async () => {
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, configurable: true });
  return mongoose.connection;
};

process.env.MONGO_URI = 'mongodb://stub:27017/aiboo';
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.AGENT_API_KEY = 'test-agent-key-abcdef123456';
process.env.CV_INGEST_KEY = 'test-cv-ingest-key-abcdef';
process.env.API_KEYS = 'test-service-key-1';
process.env.PORT = '4999';
process.env.SEED_DEMO_DATA = 'false';

// Stub Finding queries so hydration/persistence fail fast instead of
// hanging on mongoose buffering (no real mongod in this sandbox).
const { default: Finding } = await import('./models/Finding.js');
Finding.find = async () => [];
Finding.create = async () => { throw new Error('stub: no mongo in smoke test'); };

await import('./server.js');

const BASE = 'http://localhost:4999';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
await sleep(1200);

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  cond ? pass++ : fail++;
};

// 1. health
let r = await fetch(`${BASE}/health`);
check('GET /health', r.ok);

// 2. agent key rejected without header
r = await fetch(`${BASE}/api/agent/findings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('POST /api/agent/findings rejects missing key (401)', r.status === 401);

// 3. agent key rejected when WRONG length-similar key (timing-safe path)
r = await fetch(`${BASE}/api/agent/findings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'test-agent-key-abcdef123457' },
  body: '{}',
});
check('POST /api/agent/findings rejects wrong key (401)', r.status === 401);

// 4. agent key accepted with valid header
r = await fetch(`${BASE}/api/agent/findings`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'test-agent-key-abcdef123456', 'x-endpoint-id': 'smoke-endpoint' },
  body: JSON.stringify({ agent_name: 'SmokeAgent', threat_type: 'malware', severity: 'high', confidence: 0.9, summary: 'smoke test finding' }),
});
check('POST /api/agent/findings accepts valid key (201)', r.status === 201);
const finding = await r.json();
check('finding has source + id + timestamp', !!finding.source && !!finding.id && !!finding.timestamp);

// 5. CV ingest rejects when CV_INGEST_KEY set but header missing
r = await fetch(`${BASE}/api/cameras/detections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'fire', severity: 'critical', cameraId: 'x' }) });
check('POST /api/cameras/detections rejects missing service key (401)', r.status === 401);

// 6. CV ingest accepts correct key (controller path; DB unavailable → may 4xx/5xx but NOT 401)
r = await fetch(`${BASE}/api/cameras/detections`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'test-cv-ingest-key-abcdef' },
  body: JSON.stringify({ cameraId: 'x', cameraName: 'SmokeCam', location: 'lab', type: 'fire', severity: 'critical', confidence: 0.99, label: 'fire' }),
});
check('POST /api/cameras/detections passes auth with valid key (not 401)', r.status !== 401, `status=${r.status}`);

// 7. findings readable from in-memory store (public GET, no DB)
r = await fetch(`${BASE}/api/agent/findings?limit=10`);
const findings = await r.json();
check('GET /api/agent/findings returns ingested finding', Array.isArray(findings) && findings.some(f => f.agent_name === 'SmokeAgent'));

// 8. heartbeat + endpoints
r = await fetch(`${BASE}/api/agent/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'test-agent-key-abcdef123456', 'x-endpoint-id': 'smoke-endpoint' }, body: '{}' });
check('POST /api/agent/heartbeat (200)', r.status === 200);
r = await fetch(`${BASE}/api/agent/endpoints`);
const eps = await r.json();
check('GET /api/agent/endpoints shows active endpoint', Array.isArray(eps) && eps.some(e => e.source === 'smoke-endpoint' && e.active === true));

// 9. internal routes still require JWT
r = await fetch(`${BASE}/api/agent/correlated`);
check('GET /api/agent/correlated requires JWT (401)', r.status === 401);

// 10. auth register/login rate limiter present (authLimiter) — just verify route exists
r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check('POST /api/auth/login reachable (4xx not 404)', r.status !== 404, `status=${r.status}`);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
