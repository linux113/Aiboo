// demo/seed-demo.mjs — one-command demo data for the sandbox/live-demo mode.
// Idempotent: registers (or logs in) the demo admin, then tops up whatever
// is missing. Run AFTER `node demo/boot.mjs` (and optionally demo/web.mjs):
//
//   node demo/seed-demo.mjs                 # http://localhost:4000
//   BASE=http://localhost:5173 node demo/seed-demo.mjs   # through the front door
//
// Login in the UI with: admin@demo.io / Password123!
const BASE = process.env.BASE || 'http://localhost:4000';
const EMAIL = 'admin@demo.io';
const PASSWORD = 'Password123!';
const CV_KEY = 'demo-cv-ingest-key';
const AGENT_KEY = 'demo-agent-key';

const j = (r) => r.json();
const api = (path, { method = 'GET', token, key, body } = {}) =>
  fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...(key && { 'x-api-key': key }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });

// 1) auth: register first user (becomes admin), fall back to login on restart
let token;
let r = await api('/api/auth/register', { method: 'POST', body: { name: 'Demo Admin', email: EMAIL, password: PASSWORD } });
if (!r.ok) r = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
token = (await j(r)).token;
if (!token) { console.error('auth failed:', await j(r)); process.exit(1); }
const auth = { token };
console.log('✔ admin session:', EMAIL);

// 2) cameras (streamUrl is the required field)
const cams = await j(await api('/api/cameras', { token }));
if ((cams.total ?? cams.data?.length ?? 0) === 0) {
  for (let n = 1; n <= 3; n++) {
    await api('/api/cameras', {
      method: 'POST', token,
      body: { name: `Lobby Cam ${n}`, streamUrl: `rtsp://demo.local/cam${n}`, location: `Building A - Floor ${n}` },
    });
  }
  console.log('✔ seeded 3 cameras');
} else console.log('• cameras already present:', cams.total);

// 3) assets (drives systemsMonitored KPI)
const assets = await j(await api('/api/assets', { token }));
if ((assets.total ?? 0) === 0) {
  await api('/api/assets', { method: 'POST', token, body: { name: 'FIN-WS-12', type: 'workstation', ipAddress: '10.20.30.12', criticality: 'high', os: 'Windows 11 Pro' } });
  await api('/api/assets', { method: 'POST', token, body: { name: 'SRV-DC-01', type: 'server', ipAddress: '10.20.1.10', criticality: 'critical', os: 'Windows Server 2022' } });
  console.log('✔ seeded 2 assets');
} else console.log('• assets already present:', assets.total);

// 4) CV ingest — flat contract: {cameraId, type, severity, confidence(0-1)}.
// 'weapon_knife' + severity critical fans out a critical alert + auto-threat.
const dets = await j(await api('/api/cameras/detections', { token }));
if ((dets.total ?? dets.length ?? 0) === 0) {
  const camId = (await j(await api('/api/cameras', { token }))).data?.[0]?._id;
  const posts = [
    { cameraId: camId, type: 'person', severity: 'low', confidence: 0.98, label: 'person@lobby' },
    { cameraId: camId, type: 'weapon_knife', severity: 'critical', confidence: 0.91, label: 'knife@lobby' },
  ];
  for (const body of posts) {
    const res = await api('/api/cameras/detections', { method: 'POST', key: CV_KEY, body });
    if (!res.ok) console.error('  CV ingest failed:', await j(res));
  }
  console.log('✔ CV detections ingested (person + weapon_knife critical)');
} else console.log('• detections already present');

// 5) agent finding + heartbeat (only if none yet)
const findings = await j(await api('/api/agent/findings', { token }));
if ((findings.total ?? findings.length ?? 0) === 0) {
  await api('/api/agent/findings', { method: 'POST', key: AGENT_KEY, body: { agentId: 'ws-finance-01', type: 'c2_beacon', severity: 'high', description: 'Outbound beacon to known C2 every 60s', host: 'FIN-WS-12' } });
  console.log('✔ agent finding created');
} else console.log('• findings already present');
await api('/api/agent/heartbeat', { method: 'POST', key: AGENT_KEY, body: { agentId: 'ws-finance-01', status: 'healthy', metrics: { cpu: 22, mem: 48 } } });

// 6) SOAR: correlated ransomware event → pending incident (only if none pending)
const inc = await j(await api('/api/soar/incidents?status=pending', { token }));
if ((inc.total ?? 0) === 0) {
  await api('/api/agent/correlated', {
    method: 'POST', token,
    body: { event_type: 'ransomware_prelude', severity: 'critical', description: 'Mass file renames + shadow copy deletion on FIN-WS-12', entity: 'FIN-WS-12' },
  });
  console.log('✔ correlated ransomware event → PENDING incident (approve it in the UI!)');
} else console.log('• pending incident already waiting for approval');

// summary
const kpis = await j(await api('/api/dashboard/kpis', { token }));
console.log('\nDemo ready → KPIs:', JSON.stringify(kpis));
console.log(`UI login: ${EMAIL} / ${PASSWORD}`);
