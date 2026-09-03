// sandbox/web.mjs — DEMO same-origin front door for the sandbox preview.
// Serves frontend/dist + proxies /api,/socket.io -> backend:4000 and
// /agent-api -> agent:8001. Mirrors the nginx template used in production.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// resolve deps from backend/node_modules (the demo runs outside a package root)
const require = createRequire(path.join(__dirname, '..', 'package.json'));
const express = require('express');
const httpProxy = require('http-proxy');

// backend/demo -> aiboo-platform/frontend/dist
const DIST = path.join(__dirname, '..', '..', 'frontend', 'dist');
const BACKEND = process.env.BACKEND || 'http://127.0.0.1:4000';
const AGENT = process.env.AGENT || 'http://127.0.0.1:8001';
const PORT = Number(process.env.PORT || 5173);

const proxy = httpProxy.createProxyServer({ ws: true });
const agentProxy = httpProxy.createProxyServer({ ws: true });
proxy.on('error', (_e, _req, res) => res?.status?.(502)?.end?.('backend unavailable'));
agentProxy.on('error', (_e, _req, res) => res?.status?.(502)?.end?.('agent unavailable'));

const app = express();
// NOTE: no mount-path prefixes here — Express strips the mount path from req.url
// inside a handler, so `app.use('/api', h)` would forward '/auth/login' instead of
// '/api/auth/login' and the backend would 404. Match on the raw url instead.
app.use((req, res, next) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) return proxy.web(req, res, { target: BACKEND });
  if (req.url.startsWith('/agent-api')) {
    // agent API serves at root (/health, /events...) — strip the /agent-api
    // prefix the frontend uses to disambiguate from the backend's /api.
    req.url = req.url.replace(/^\/agent-api/, '') || '/';
    return agentProxy.web(req, res, { target: AGENT, prependPath: false });
  }
  next();
});
app.use(express.static(DIST));
app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

const server = http.createServer(app);
server.on('upgrade', (req, socket, head) => {
  if (req.url.startsWith('/socket.io')) proxy.ws(req, socket, head, { target: BACKEND });
  else socket.destroy();
});
server.listen(PORT, '0.0.0.0', () => console.log(`demo web on :${PORT} -> backend ${BACKEND}, agent ${AGENT}`));
