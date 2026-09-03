# Running AiBoO in VS Code — the complete guide

> The repo now ships with a ready-made VS Code workspace (in `aiboo-platform/.vscode/`):
> **F5 debugger configs for all 4 services · one-click tasks · REST-client API playground
> (`api.http`) · extension recommendations · tuned settings.** This guide shows both
> ways to run: full-Docker (simplest) and hybrid debug mode (recommended for development).

---

## 0. One-time setup (15 min)

### Install
| Tool | Why | Check |
|---|---|---|
| **VS Code** | the IDE | `code --version` |
| **Docker Desktop** | infra (Mongo/Redis) or the whole stack | `docker compose version` |
| **Node.js 20+** | backend + frontend when running locally | `node -v` |
| **Python 3.11+** | agent + cv-service when running locally | `python3 --version` |
| **git** | clone | `git --version` |

### Open the project
```bash
git clone https://github.com/linux113/Aiboo.git
code Aiboo/aiboo-platform        # ⚠ open the aiboo-platform FOLDER (that's the workspace root)
```
VS Code will prompt: *"This workspace has extension recommendations"* → click
**Install All** (ESLint, Prettier, Python + Pylance, Docker, **REST Client**,
MongoDB for VS Code, Tailwind IntelliSense, YAML). The REST Client extension is
what powers the `api.http` playground.

### Get the code ready
Menu: **Terminal → Run Task… → `aiboo: install deps (backend+frontend+agent+cv)`**
(or paste the command from that task into a new terminal — `` Ctrl+` `` toggles it).

---

## 1. Mode A — Full stack in Docker (simplest, no debugging)

For trying the product end-to-end:

1. **Terminal → Run Task… → `aiboo: docker up (full stack)`** (first build ≈ 5 min)
   — same as `docker compose --profile redis up -d --build`
2. Create secrets first! `cp .env.example .env` and fill 6× `openssl rand -hex 32`.
   (Without them the backend crash-loops **on purpose** — the boot guard.)
3. Verify: `curl localhost:4000/health` → `{"status":"ok"}`
4. Browse **http://localhost:5173** → Register → *first account = ADMIN*
5. Stop: task `aiboo: docker down`

Everything runs inside containers; VS Code is just a fancy terminal here.
Use **Docker extension** (whale icon in the sidebar) to view logs/containers
without typing commands.

### Mode A+ — Real stack, one command, logs on disk (recommended first run)

Real MongoDB + Redis in docker, real **host processes** for backend/agent/web,
every log mirrored to files. Zero manual secret generation:

1. **Terminal → Run Task… → `aiboo: real stack up (mongo+redis+backend+agent+web, logs→files)`**
   (= `scripts/real-stack.sh up`; first run generates `backend/.env` with fresh
   `openssl rand` secrets, installs deps, builds the same-origin UI)
2. Browse **http://localhost:5173** → Register → first account = ADMIN
3. Logs: task **`aiboo: real stack logs (tail)`** or open `logs/backend.log`
   (JSON lines — set a pino log-viewer extension, or just read raw)
4. Health: task `aiboo: real stack status` · Stop: task `aiboo: real stack down`

Data persists in the `mongo_data` volume. To DEBUG the real stack, keep the
infra from this mode and F5 the compound **🚀 Real hybrid stack** — it launches
`Backend (dev)` (now with `LOG_FILE` + `REDIS_URL` preset), `Agent (API mode)`
and `Web front door (node)` together.

---

## 2. Mode B — Hybrid debug mode (recommended for development)

Run **infrastructure in Docker, code under the VS Code debugger**. You get
breakpoints in backend routes, agent engines, and React components — all live
against real Mongo/Redis.

### Step 1 — Start infra (Mongo + Redis only)
**Terminal → Run Task… → `aiboo: infra up (mongo+redis via Docker)`**

### Step 2 — Launch the backend under the debugger
- Open **Run and Debug** panel (`Ctrl+Shift+D`)
- Pick **"Backend (dev)"** in the dropdown → press **F5**
- The launch config already injects dev env vars (`NODE_ENV=development`,
  dev secrets, `MONGO_URI=mongodb://localhost:27017/aiboo`, demo seeding) —
  the boot guard passes, no `.env` needed for this mode.
- Set a breakpoint anywhere, e.g. `backend/services/camera.service.js` →
  `createDetection` — you'll hit it in Step 6.

### Step 3 — Launch the agent (pick one)
Same panel, dropdown → **F5** (yes, multiple debug sessions run at once —
switch between them with the dropdown in the debug toolbar):
- **"Agent (API mode)"** — lightweight ingestion API (`:8001`)
- **"Agent (full tri-gate orchestrator)"** — full pipeline: tri-gate, 7 agents,
  15 engines, dashboard bridge → use this to debug detection logic

### Step 4 — Frontend with breakpoints in your TSX
1. **Terminal → Run Task… → `aiboo: frontend dev (vite)`** (keeps running)
2. Run-and-Debug dropdown → **"Frontend (Chrome debug)"** → F5
   → Chrome opens at `localhost:5173`, and breakpoints in
   `frontend/src/**.tsx` now HIT (source-mapped through Vite).

### Step 5 — (optional) CV service
Dropdown → **"CV service"** → F5. First run downloads `yolov8n.pt` (~6 MB).

### What's running now
| Service | Port | Launched by | Debuggable |
|---|---|---|---|
| MongoDB + Redis | 27017 / 6379 | Docker task | — |
| Backend | 4000 | F5 "Backend (dev)" | ✅ breakpoints |
| Agent | 8001 | F5 agent config | ✅ (`justMyCode: false` — you can step INTO engines) |
| Frontend | 5173 | vite task + F5 Chrome | ✅ TSX breakpoints |
| CV | 5050 | F5 "CV service" | ✅ |

### Step 6 — Drive the whole pipeline with `api.http`
Open **`api.http`** in the editor. Every block has a small **Send Request**
link above it (REST Client extension):

1. **Register** → response contains `"token"` → copy it into the `@token`
   variable at the top of the file → (first user = admin)
2. **POST fire detection** (sends `X-API-Key`) → your breakpoint in
   `createDetection` fires; continue → the dashboard red banner appears
3. **POST agent finding with IoC** `203.0.113.66` → watch intel enrichment
4. **POST correlated ransomware alert** → SOAR creates a pending incident →
   **GET pending incidents** → copy `_id` → **approve** it
5. **POST /events directly to the agent** (`:8001`) → breakpoint in
   `agent/gates/gate1_perimeter.py` → then watch Gate 2/3 + engines in the
   Debug Console, and the finding arrive at the backend bridge

### Step 7 — Debug console tricks
- Backend stopped at a breakpoint: hover variables, or type in **Debug Console**:
  `data`, `req.user`, `detection.toObject()`
- Agent: `event.payload`, `self.known_entities()` on the orchestrator frame
- Conditional breakpoints: right-click a breakpoint → *Edit Breakpoint* →
  e.g. `data.type === "fire"` — so the loop doesn't stop for persons/vehicles
- Logpoints (no pause): right-click gutter → *Add Logpoint* → great for
  watching every detection without interrupting

---

## 3. Running the test suites from VS Code

| Suite | How |
|---|---|
| Backend smoke (64 checks, no DB) | Task `test: backend smoke` — or F5 config **"Backend: smoke tests"** to debug a failing check |
| Agent pytest (86) | Task `test: agent pytest`, or the **Testing sidebar** (beaker icon) — pytest is pre-configured in settings.json; run/Debug individual tests from the tree |
| Frontend types | Task `check: frontend types (tsc)` — errors appear inline in Problems panel |
| Helm chart | Task `check: helm chart` |

---

## 4. Env vars in VS Code — who wins?

| Mode | Source of truth |
|---|---|
| F5 debug configs | `env` block in `.vscode/launch.json` (dev values, safe) |
| Docker mode | `.env` file at `aiboo-platform/` root (real secrets) |
| Production | external secret manager / helm `auth.secretName` |

The backend boot guard aborts if it sees production mode + default secrets —
debug configs set `NODE_ENV=development` so this never bites you in F5.

---

## 5. Ports panel & remote work
Running VS Code over **Remote-SSH or in a Codespace**? The **Ports** panel
(auto-forwards) makes 5173/4000/8001/5050 reachable from your browser —
the frontend is same-origin through the Vite dev proxy? No — in dev mode the
SPA calls `localhost:4000` directly (baked defaults), so forward **both**
5173 and 4000. Socket.IO and CORS are already configured for
`localhost:5173`.

---

## 6. Troubleshooting in VS Code

| Symptom | Fix |
|---|---|
| "docker: command not found" in tasks | Start Docker Desktop; on Windows use WSL2 backend |
| Backend F5 exits instantly (`PRODUCTION BOOT ABORTED`) | You set prod env vars somewhere — use the shipped dev config, or fill `.env` |
| Backend F5 exits `MongoNetworkError` | Infra task not running → `aiboo: infra up` |
| Python breakpoints not hit | Click the Python interpreter in the status bar → select 3.11 with the deps installed; ensure config has `justMyCode: false` (ours does) |
| Chrome debug opens but TSX breakpoints are grey | Start the **vite task FIRST**, then F5 Chrome; refresh the page after attaching |
| `api.http` "Send Request" missing | Install the **REST Client** extension (workspace recommends it) |
| Port 4000 already in use | A previous debug session lives on: **Terminal panel → Ports/Output** or kill: `lsof -ti:4000 | xargs kill` (macOS/Linux) |
| 401 loops in `api.http` | `@token` expired (1 h) → re-send Login, paste fresh token |
| Vite task "already running" | Terminal list (dropdown in terminal panel) → kill the old one |

---

## 7. Shortcut cheat-sheet

| Keys | Action |
|---|---|
| `Ctrl+`` ` | toggle terminal |
| `Ctrl+Shift+D` | Run and Debug panel |
| `F5` / `Shift+F5` | start / stop debugger |
| `Ctrl+Shift+P` → "Tasks: Run Task" | all aiboo tasks |
| `Ctrl+Shift+M` | Problems panel (tsc errors) |
| `Ctrl+K Ctrl+S` | keyboard settings |

---

## Quick reference — file map

```
aiboo-platform/
├── .vscode/
│   ├── launch.json      ← F5 configs: Backend (dev) / smoke / Agent API /
│   │                       Agent orchestrator / CV / Frontend-Chrome
│   ├── tasks.json       ← infra up/down, deps, vite, docker, all test suites
│   ├── settings.json    ← eslint, pytest, yaml schemas, rest-client
│   └── extensions.json  ← recommended extensions
├── api.http             ← click-through API playground (auth→ingest→SOAR→intel)
├── RUNBOOK.md           ← running without VS Code (Docker/local/K8s/ops)
└── PRODUCTION_READINESS.md / PRODUCT_REPORT.md / EDR_ALIGNMENT.md
```
