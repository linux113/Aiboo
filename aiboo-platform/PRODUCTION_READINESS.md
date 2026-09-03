# AiBoO — Production Readiness Report

> Audit date: 2026-09-03 · Scope: `aiboo-platform/` (backend, frontend, agent, cv-service, deployment)
> Status after this pass: **Phase 1 (critical blockers) COMPLETE** · Phases 2–4 pending

---

## 0. Executive summary

The platform is a working **alpha** (29/30 infra checks, 87 tests) but was not
deployable: hardcoded tunnel URLs, demo-default secrets accepted in production,
an unauthenticated detection-ingest endpoint, in-memory agent data (lost on
restart), a Docker image that could never run the tri-gate orchestrator, and a
frontend whose baked-in `localhost` URLs break on any real host.

**Phase 1 fixed all of the above.** What remains for "industry-grade" is listed
in §3 (Phase 2–4 backlog) — observability, Redis-backed session/state, tests,
K8s/GPU scale-out, SIEM/SOAR + compliance integration.

---

## 1. What was fixed in this pass (Phase 1 — critical blockers)

### 1.1 Hardcoded URLs / env handling (`agent`)
| File | Before | After |
|---|---|---|
| `core/orchestrator.py` | `DashboardBridge(bus, backend_url='https://stuffy-volley-had.ngrok-free.dev')` | env chain: `REMOTE_URL` → `NODE_BACKEND` → `config.ini` → `http://localhost:4000` |
| `core/orchestrator.py` `_load_config()` | ngrok fallback default | same env-first chain; config.ini read as UTF-8 |
| `main.py` | `'remote_url': 'https://your-ngrok-url.ngrok-free.dev'` default written into config.ini | env-derived default |
| `core/config.py` | — | `remote_url`, `endpoint_name`, engine kill-switches; **fail-fast `RuntimeError` on default secrets when `AIBOO_ENV=production`** |
| `run_api.py` / Dockerfile | API-only container, tri-gate never ran | `RUN_ORCHESTRATOR=true` runs the full orchestrator in-container |

**Rule now enforced:** tunnel URLs are runtime-injected env vars, never code.

### 1.2 Unicode cp1252 crash → engines re-enabled
- New `agent/utils/logging_setup.py`: reconfigures stdout/stderr to UTF-8
  `errors='replace'` before any handler attaches; wired into `main.py`,
  `run_api.py`, `api/agent/ingestion_api.py`; Dockerfile sets
  `PYTHONIOENCODING=utf-8 LANG=C.UTF-8`.
- Re-enabled **CommandDashboard** (on by default), **AutonomousResponseEngine**
  and **RealResponseEngine** (opt-in via `ENABLE_AUTONOMOUS_RESPONSE` /
  `ENABLE_REAL_RESPONSE`, default **off** — they take real host actions).
- `WindowsEventIngestor` no longer crashes the orchestrator on Linux — it
  degrades to API-only ingestion. **This was why the Docker agent never ran
  the tri-gate.**

### 1.3 Secrets hardening (`backend`)
- New `middleware/security.js`:
  - `safeEqual()` — `crypto.timingSafeEqual` for **all** API-key checks
    (agent key, service keys) → no more timing attacks.
  - `assertProductionSecrets()` — **boot aborts in production** if
    `JWT_SECRET` is default/short, or `AGENT_API_KEY` / `API_KEYS` /
    `CV_INGEST_KEY` are missing/default.
- `POST /api/cameras/detections` now authenticated: CV service sends
  `X-API-Key: CV_INGEST_KEY` (both initial post and retry loop). Unset key =
  dev-only mode with a loud one-time warning.
- Single canonical key per hop (no more `API_KEYS` vs `AGENT_API_KEY` confusion
  on the same endpoints — `API_KEYS` is for `protect`, `AGENT_API_KEY` for
  `/api/agent/*`, `CV_INGEST_KEY` for CV ingest).

### 1.4 Agent data persistence (backend)
- Findings are now **write-through persisted to MongoDB** (existing `Finding`
  model) on both ingest paths (`POST /api/agent/findings`, `POST /api/agent/finding`).
- On boot, the in-memory store is **rehydrated from Mongo** (latest 200,
  non-blocking) → backend restart no longer wipes agent history.
- Agent offline queue SQLite path is configurable (`ALERT_QUEUE_DB_PATH`) and
  docker-compose mounts a volume → queue survives container restarts.

### 1.5 Frontend/deployment actually works off-localhost
- `frontend/Dockerfile`: `VITE_*` flow in as **build ARGs** (they were runtime
  `environment:` entries before — Vite ignores those at runtime; the values
  were never actually applied).
- `nginx.conf.template` (envsubst via official nginx image): SPA now calls
  **same-origin relative URLs** — `/api`, `/socket.io`, `/agent-api/`,
  `/cv-api/` — nginx proxies each to the right service. Works behind any
  domain/tunnel/preview host with zero rebuilds.
- **Fixed camera streams 401-ing in production:** `<img>` tags cannot send
  `Authorization` headers, so nginx injects `Authorization: Bearer
  $CV_AUTH_TOKEN` server-side when proxying `/cv-api/` — the browser never
  sees the CV token.
- CSP tightened: removed `unsafe-eval`, dropped wildcard `http:`/`https:`
  img-src, added `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`.
- `docker-compose.yml`: all secrets interpolated from root `.env`
  (see `.env.example`); Mongo bound to `127.0.0.1` only; agent runs full
  orchestrator; `SEED_DEMO_DATA=false` default.

### 1.6 Repo hygiene
- Removed committed **49 MB** `agent/dist.zip` build artifact; `.gitignore`
  now also covers `*.db`, `alerts_queue.db`, `config.ini` (contains agent
  api_key), `dist.zip`.
- Refreshed `backend/.env.example`, `agent/.env.example`, new root
  `.env.example` with per-secret `openssl rand -hex 32` instructions.

### 1.7 Verification (this pass)
| Check | Result |
|---|---|
| `node --check` on all changed backend files | OK |
| `python -m py_compile` on all changed agent/cv files | OK |
| New `backend/smoke-test.mjs` (boots real server, hits 12 security/ingest/persistence paths) | **12/12 PASS** |
| Agent pytest suite (with pytest-asyncio installed) | **85/86** — 1 pre-existing failure (`test_subscriber_error_handling`, fails on pristine commit too) |
| Orchestrator construction on Linux with env URL override | OK (`backend_url=http://backend:4000`, no ngrok) |

---

## 2. Known issues that remain open (accepted for now)

1. **AI chat fallback** — without `OPENAI_KEY` the backend returns heuristic
   responses (by design); no circuit breaker yet.
2. **JWT in `localStorage`** — XSS-stealable. Phase 2 moves to httpOnly
   refresh-cookie rotation.
3. **In-memory `correlated` / `gateDecisions` / `pseudoLocks`** — only findings
   are persisted so far (correlated alerts should also create `Threat` docs).
4. **`tokenBlacklist` Map** — in-memory; revocation resets on restart (Redis in Phase 2).
5. **Rate-limiter store** — per-process memory; needs Redis before scaling horizontally.
6. **`Threat.source` enum** (`firewall|camera|va-scan`) rejects agent sources
   like `network_intrusion` — needs widening + Zod validation.
7. **No frontend tests**, agent tests thin (7 real assertions before deps fix).
8. **CV `require_auth`** accepts only static bearer tokens (nginx now holds it
   server-side; short-lived signed URLs are the proper Phase 3 fix).

---

## 3. Pending backlog to be industry-grade (Phases 2–4)

### Phase 2 — Hardening (next 2–4 weeks of work)
| # | Item | Why it matters |
|---|---|---|
| 2.1 | **Redis** service: rate-limit store, token blacklist, Socket.IO adapter | multi-instance safety; revocation survives restarts |
| 2.2 | **Zod/Joi request validation** on every mutating route | enum 500s, malformed payloads, mass-assignment |
| 2.3 | **httpOnly refresh-token cookies** + short-lived access JWTs | kill localStorage XSS token theft |
| 2.4 | **Audit log collection** (who acked/escalated/locked what, immutable) | SOC 2 / ISO 27001 evidence trail |
| 2.5 | **Swagger/OpenAPI** at `/api/docs` + API versioning (`/api/v1`) | enterprise integration requirement |
| 2.6 | **Correlated alerts → `Threat` documents** + retention TTL indexes on `Detection` | unbounded growth; restart-safe SOC state |
| 2.7 | **Tests**: backend Jest+Supertest ≥80%, frontend Vitest+RTL, agent pytest for gates/engines; CI gate | right now 0 frontend tests |
| 2.8 | **Secrets manager** (Vault/Doppler/Infisical or SSM) instead of `.env` files | rotation, least-privilege, no laptop-leak secrets |
| 2.9 | Correlation-ID middleware + **Pino → Loki** structured log shipping | incident forensics |
| 2.10 | `express-mongo-sanitize`, dependency SBOM (syft), SAST in CI (trivy tuned to fail CRITICAL only) | supply-chain hygiene |

### Phase 3 — Scale & performance
- **Kubernetes + Helm chart** (or docker-swarm if single-tenant): liveness/readiness probes (healthchecks exist), HPA on backend, ConfigMap/Secret injection.
- **CV on GPU nodes** (TensorRT/ONNX export of YOLOv8, shared model server via
  Triton, batch frames) — one worker-thread-per-camera tops out ~10–20 streams
  on CPU; model registry instead of per-container `yolov8n.pt` downloads.
- **WebRTC/HLS** ingest instead of MJPEG `<img>` tiles (bandwidth, >50 cams).
- **Face recognition** upgrade from Haar detection to embedded-vector models
  (ArcFace/FaceNet) with **PII policy** (GDPR: no faces at rest, vectors only).
- Replace bespoke Zero-Trust PDP/PEP with **OPA/Cedar** policy engine.
- Multi-tenancy: tenant_id scoping across all collections + per-tenant RBAC.

### Phase 4 — Industry features (enterprise SOC parity)
- **SIEM integration**: CEF/LEEF export, Splunk/Elastic/ Sentinel event forwarding.
- **SOAR playbooks**: webhook/queue-driven response actions with approval gates.
- **Notification fabric**: Slack/Teams/PagerDuty/SMTP on `alert:critical`.
- **Threat intel feeds**: MISP, AbuseIPDB, VirusTotal enrichment in
  `threat_intelligence_engine` (currently static heuristics).
- **Compliance engine**: real NIST 800-53 / CIS benchmark rule packs, PDF audit
  reports, data-retention policies (90-day detections), Mongo encryption-at-rest
  (CSFLE), S3 + lifecycle rules for snapshots.
- **Pen test + bug bounty** before any external exposure.

---

## 4. Architecture direction — patterns adopted from reference repos

### From `ruvnet/ruflo` (agent meta-harness / swarm orchestration)
| Ruflo pattern | AiBoO application |
|---|---|
| Router → Swarm → Agents → Memory with a **learning loop** | Aiboo's EventBus→Orchestrator→7 specialist agents is the same shape; next step is persistent **agent memory** (store gate decisions/outcomes in Mongo, feed `BehavioralDNAEngine` baselines from history instead of cold-start each boot) |
| Hooks system that auto-routes tasks | Generalize tri-gate: emit every event through a policy hook chain so engines can be added declaratively instead of hand-wired in `orchestrator.py` |
| Federation (agents on many machines, secure cross-talk) | The `X-API-Key` + heartbeat endpoints model already matches; add per-endpoint keys + mTLS for agent↔backend instead of one shared `AGENT_API_KEY` |
| Daemon health/telemetry of every agent | Extend `/api/agent/endpoints` with per-agent lag, queue depth, last-event-age metrics surfaced on the dashboard |

### From `OpenBMB/ChatDev` (zero-code multi-agent orchestration)
| ChatDev pattern | AiBoO application |
|---|---|
| Declarative agents/workflows (YAML) instead of code | Move engine enable/disable, thresholds, gate rules from Python constants to a versioned `policy.yaml` (mirrors the env kill-switches added in Phase 1, but reviewable/diffable as config) |
| Schema registry for typed inter-agent messages | `core/events.py` dataclasses are close; publish a JSON schema per event type so the Node backend and agent can validate findings both directions |
| Orchestrator sequences agents dynamically (puppeteer paradigm) | Long-term: risk-scored routing — MetaRiskArbiter decides which specialist agents a event fans out to, instead of all 7 seeing everything |
| compose.yml with env_file layering | Adopted: root `.env` → compose interpolation → per-service env (done in this pass) |

---

## 5. Quick start (secure local stack)

```bash
cd aiboo-platform
cp .env.example .env
# fill every <generate-with-openssl-rand-hex-32> with real secrets
docker compose up -d --build
# frontend http://localhost:5173  (all traffic same-origin via nginx)
```

Production smoke checks:
```bash
curl -s localhost:4000/health            # backend
curl -s localhost:8001/health            # agent API
curl -s localhost:5050/health            # cv
curl -s -X POST localhost:4000/api/agent/findings -H 'content-type: application/json' \
     -H 'x-api-key: WRONG' -d '{}'       # must be 401
```

Backend security smoke suite: `cd backend && node smoke-test.mjs` (12 checks).
