# AiBoO RUNBOOK — how to run the platform

Everything below is copy-paste ready. Four ways to run: **Docker (recommended)**,
**demo mode (fastest — any system, zero infra)**, **local dev (no Docker)**, or
**Kubernetes** (see `deploy/DEPLOY_K8S.md`).

---

## 0. Demo mode — any system, zero infra (2 minutes)

Runs the whole platform (API + UI + agent API) with Node only — no Mongo, Redis,
or Docker. Data is **in-memory** (restart wipes it; re-run the seeder). Perfect
for a laptop demo or a quick look at the UI.

```bash
# 1. Build the UI once (same-origin bundle)
cd aiboo-platform/frontend && npm install
VITE_API_URL=/api VITE_SOCKET_URL= VITE_AGENT_URL=/agent-api VITE_CV_URL=/cv-api npm run build

# 2. Install backend deps + start API (:4000) and web front door (:5173)
cd ../backend && npm install
node demo/boot.mjs &          # REST API + socket.io on :4000
node web.mjs &                # serves frontend/dist, proxies /api + /agent-api

# 3. Seed admin + demo data (idempotent — safe to re-run after any restart)
node demo/seed-demo.mjs
```

Open **http://localhost:5173** → login `admin@demo.io` / `Password123!`.
You get 3 cameras, 2 CV detections (one critical weapon), agent finding,
2 assets, and a **pending SOAR incident** to approve.

> Windows PowerShell for step 1: `$env:VITE_API_URL='/api'; $env:VITE_SOCKET_URL=''; $env:VITE_AGENT_URL='/agent-api'; $env:VITE_CV_URL='/cv-api'; npm run build`
>
> Optional: also run the Python agent API (`cd ../agent && python3 run_api.py`,
> port 8001) — `web.mjs` proxies `/agent-api` to it automatically.

---

## A0. Real stack — one command (all real: MongoDB + Redis + processes)

No demo shims: **real MongoDB 7 + Redis 7** (docker, loopback-only ports) and
**real backend / agent / web processes** on the host, all logs written to files.

```bash
scripts/real-stack.sh up        # first run: generates backend/.env with real
                                # random secrets, installs deps, builds UI
scripts/real-stack.sh status    # health of every component
scripts/real-stack.sh logs      # tail -f all service logs (Ctrl-C to exit)
scripts/real-stack.sh down      # stop (data volumes KEPT)
```

| What | Where |
|---|---|
| Backend log (JSON lines) | `logs/backend.log` (via `LOG_FILE`) |
| Agent API log | `logs/agent.log` |
| Front door log | `logs/web.log` |
| MongoDB / Redis | `docker logs aiboo-mongodb` / `aiboo-redis` |
| Security audit trail | UI → Settings → Audit, or `GET /api/audit` (admin JWT) |

First user you register in the UI becomes admin — data persists in the
`mongo_data` docker volume across restarts. In VS Code: task
**`aiboo: real stack up`** or the compound **🚀 Real hybrid stack** (F5, with
breakpoints — see VSCODE_GUIDE.md).

---

### 1. Prerequisites
- Docker Desktop (or Engine + Compose v2) — `docker compose version` works
- 6 GB RAM free (CV service loads a YOLO model), ports free: 4000 / 5173 / 5050 / 8001 / 27017 / 6379

### 2. Configure secrets (2 minutes)
```bash
git clone https://github.com/linux113/Aiboo.git && cd Aiboo/aiboo-platform
cp .env.example .env

# generate all 6 secrets at once and paste them into .env:
for i in 1 2 3 4 5 6; do openssl rand -hex 32; done
```
Fill in `.env`: `JWT_SECRET`, `AGENT_API_KEY`, `INTERNAL_API_KEY`, `API_KEYS`,
`CV_INGEST_KEY`, `CV_AUTH_TOKEN` (one generated value each). Leave the rest as-is.
> ⚠️ The backend **refuses to boot** with empty/default secrets — that's the boot
> guard. If you see `PRODUCTION BOOT ABORTED`, a secret is missing.

### 3. Start everything
```bash
docker compose --profile redis up -d --build        # ~5 min first build
docker compose ps                                    # all should be Up/healthy
docker compose logs -f backend                       # Ctrl-C to stop following
```

### 4. Verify (1 minute)
```bash
curl -s localhost:4000/health        # {"status":"ok",...}
curl -s localhost:8001/health        # agent
curl -s localhost:5050/health        # cv
# security sanity — must be 401:
curl -s -X POST localhost:4000/api/cameras/detections \
  -H 'content-type: application/json' -d '{"type":"fire"}'
```

### 5. First login (important)
- Open **http://localhost:5173**
- Click **Register** — the **first account you create becomes the ADMIN**
  (subsequent registrations are analysts; nobody can self-assign admin — by design)
- Passwords need ≥ 8 characters

### 6. Add a camera and see detections
Dashboard → **Surveillance** → *Add Camera*:
- **Name**: any, **Stream URL**: an `http://...m3u8`/`.mjpg` feed or `rtsp://...`
  (public internet URLs; the CV service blocks private/localhost URLs by SSRF guard)
- No camera hardware? Use the webcam option or a public test stream, e.g.
  `https://videos.pexels.com/...` style MJPEG links
- Within seconds the tile shows the live annotated stream; detections
  (person/vehicle/fire/…) land in the feed with severity + confidence

### 7. Fire a test through the whole pipeline
```bash
TOKEN=<paste access token from browser localStorage>
# critical detection → dashboard alert + (if configured) Slack/PagerDuty:
curl -s -X POST localhost:4000/api/cameras/detections \
  -H "content-type: application/json" \
  -H "x-api-key: <CV_INGEST_KEY from .env>" \
  -d '{"cameraId":"test","cameraName":"Lobby","type":"fire","severity":"critical","confidence":0.9}'
# watch the red banner appear on the dashboard instantly (Socket.IO)

# SOAR: send a ransomware-pattern correlated event → pending incident:
curl -s -X POST localhost:4000/api/agent/correlated \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"event_type":"ransomware_prelude","severity":"critical","description":"test","entity":"HOST-1"}'
# then Dashboard/Intelligence → approve or reject it (audited)
```

### 8. Optional integrations (in `.env`, then `docker compose up -d`)
```env
ALERT_SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
ALERT_PAGERDUTY_ROUTING_KEY=xxx
ABUSEIPDB_API_KEY=xxx            # threat-intel enrichment
```
Test channels: `curl -X POST localhost:4000/api/notifications/test -H "authorization: Bearer $TOKEN"`

### 9. API docs
`http://localhost:5173/api/docs` — Swagger UI (admin/analyst token in prod; open in dev).

---

## B. Local development (no Docker)

Needs Node 20+, Python 3.11+, MongoDB & Redis running locally.
```bash
# terminal 1 — backend
cd backend && npm ci && cp .env.example .env   # set secrets, MONGO_URI
npm run dev                                     # :4000

# terminal 2 — frontend (vite dev server proxies nothing; set env or use defaults)
cd frontend && npm ci && npm run dev            # :5173 → expects backend on :4000

# terminal 3 — agent
cd agent && pip install -r requirements.txt
cp .env.example .env                            # NODE_BACKEND=http://localhost:4000
python run_api.py                               # :8001 (API mode)
RUN_ORCHESTRATOR=true python run_api.py         # full tri-gate mode

# terminal 4 — cv service
cd cv-service && pip install -r requirements.txt
CV_HOST=0.0.0.0 CV_INGEST_KEY=<same as backend> python app.py   # :5050
```
Dev conveniences: `SEED_DEMO_DATA=true` seeds demo agent findings;
`RATE_LIMIT_DISABLED=true` while load-testing; `NODE_ENV=development` widens CORS.
> ⚠️ `npm run seed` **drops the database** and creates weak demo users
> (`admin@example.com/admin123`) — dev only; it refuses to run in production
> unless `SEED_FORCE=true`.

---

## C. Windows endpoints (the EDR sensor)
1. Copy `plugin/` to the Windows machine, run `install.bat` as admin
2. Edit `config.txt`: `remote_url=https://<your-backend>`, `api_key=<AGENT_API_KEY>`
3. The agent appears under **Endpoints** within 2 minutes of heartbeats
4. Full tri-gate needs the Python agent (`agent/`) with pywin32 — see `CLIENT_SETUP.md`

---

## D. Daily operations
| Task | Command |
|---|---|
| Logs (JSON, with request-ids) | `docker compose logs -f backend \| jq 'select(.level>=40)'` |
| Who did what | UI → Settings/Audit, or `GET /api/audit?action=response.isolate` |
| Pending SOAR approvals | `GET /api/soar/incidents?status=pending` → approve/reject |
| Channel health | `GET /api/notifications/channels` / `history` |
| Restart one service | `docker compose restart cv-service` |
| Stop everything | `docker compose down` (add `-v` to WIPE data) |
| Upgrade | `git pull && docker compose up -d --build` |

## E. Troubleshooting
| Symptom | Cause → fix |
|---|---|
| Backend crash-loops, "PRODUCTION BOOT ABORTED" | Missing/default secret in `.env` → fill + `docker compose up -d` |
| Backend exit "MongoDB connection refused" | Mongo unhealthy → `docker compose logs mongodb` |
| Camera tile shows 401/error | Expected only if CV_AUTH_TOKEN mismatch → same value in `.env` & `CV_AUTH_TOKEN` |
| Camera add rejected "private/reserved IP" | CV SSRF guard blocks LAN streams → use public URL or run CV on the camera LAN |
| No detections from a stream | Unsupported codec / stream offline → check `docker compose logs cv-service` |
| 401 loops in UI after 1h | Refresh blocked — cookies need same-origin: use http://localhost:5173, not :4000 |
| Agent endpoint never "live" | Wrong AGENT_API_KEY or remote_url unreachable from the endpoint |
| Slack/PagerDuty silent | Check `/api/notifications/history` for failed deliveries (dead-letter in audit log) |

## F. Kubernetes
One command summary (full guide: `deploy/DEPLOY_K8S.md`):
```bash
helm upgrade --install aiboo deploy/helm/aiboo -n aiboo --create-namespace \
  --set auth.createSecret=true \
  --set auth.jwtSecret=$(openssl rand -hex 32) ... (6 secrets) \
  --set ingress.host=soc.example.com
```
