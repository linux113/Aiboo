// demo/boot-backend.mjs — DEMO launcher: backend with in-memory stores.
// Usage: node backend/demo/boot-backend.mjs   (from aiboo-platform/)
// Data is volatile; restart wipes it. See memory-store.mjs.
process.env.NODE_ENV = 'development';
process.env.PORT = process.env.PORT || '4000';
process.env.MONGO_URI = 'mongodb://memory:aiboo';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'demo-secret-demo-secret-demo-secret-0987';
process.env.AGENT_API_KEY = process.env.AGENT_API_KEY || 'demo-agent-key';
process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'demo-internal-key';
process.env.CV_INGEST_KEY = process.env.CV_INGEST_KEY || 'demo-cv-ingest-key';
process.env.API_KEYS = process.env.API_KEYS || 'demo-service-key';
process.env.CORS_ORIGINS = '*';
process.env.SEED_DEMO_DATA = 'true';
process.env.RATE_LIMIT_DISABLED = 'true'; // demo friendliness
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// 1) stub the connection before anything imports server.js
const mongoose = (await import('mongoose')).default;
mongoose.connect = async () => {
  Object.defineProperty(mongoose.connection, 'readyState', { value: 1, writable: true, configurable: true });
  return mongoose.connection;
};

// 2) swap every model for the in-memory adapter
const { adaptModel } = await import('./memory-store.mjs');
const modules = {
  User: { hashPassword: true },
  Camera: {}, Detection: {}, Threat: {}, Finding: {}, AuditLog: {},
  ResponseAction: {}, Playbook: {}, Incident: {}, Asset: {},
  IdentityRisk: {}, Vulnerability: {}, CameraEvent: {},
};
for (const [name, opts] of Object.entries(modules)) {
  const mod = await import(`../models/${name}.js`);
  adaptModel(mod.default, name, opts);
}

// 3) boot the real server
await import('../server.js');
