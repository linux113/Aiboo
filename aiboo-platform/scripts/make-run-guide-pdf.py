#!/usr/bin/env python3
"""Generate AIBOO_REAL_RUN_AND_TEST_GUIDE.pdf — shareable, detailed guide for
running the REAL AiBoO stack (no demo shims) on any system and testing it.

Regenerate after editing:  python3 scripts/make-run-guide-pdf.py
(pip install reportlab)
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, KeepTogether, HRFlowable)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'AIBOO_REAL_RUN_AND_TEST_GUIDE.pdf')

# ─── palette ────────────────────────────────────────────────────────────────
INK = colors.HexColor('#0f172a')
ACC = colors.HexColor('#0e7490')   # teal accent
ACC2 = colors.HexColor('#155e75')
CODE_BG = colors.HexColor('#f1f5f9')
CODE_BD = colors.HexColor('#cbd5e1')
HEAD_BG = colors.HexColor('#0e7490')
ROW_ALT = colors.HexColor('#f8fafc')
WARN = colors.HexColor('#b45309')

S = {
    'title':  ParagraphStyle('t',  fontName='Helvetica-Bold', fontSize=25, leading=30, textColor=INK),
    'sub':    ParagraphStyle('s',  fontName='Helvetica', fontSize=11.5, leading=16, textColor=colors.HexColor('#475569')),
    'h1':     ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=16, leading=20, textColor=ACC2, spaceBefore=14, spaceAfter=6),
    'h2':     ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=12, leading=15, textColor=INK, spaceBefore=10, spaceAfter=4),
    'p':      ParagraphStyle('p',  fontName='Helvetica', fontSize=9.5, leading=13.5, textColor=INK, alignment=TA_LEFT, spaceAfter=5),
    'li':     ParagraphStyle('li', fontName='Helvetica', fontSize=9.5, leading=13.5, textColor=INK, leftIndent=14, bulletIndent=4, spaceAfter=3),
    'code':   ParagraphStyle('c',  fontName='Courier', fontSize=8.4, leading=11.5, backColor=CODE_BG, borderColor=CODE_BD,
                             borderWidth=0.6, borderPadding=(5, 6, 5, 6), textColor=INK, spaceAfter=6),
    'codew':  ParagraphStyle('cw', fontName='Courier', fontSize=8.4, leading=11.5, textColor=ACC2),
    'note':   ParagraphStyle('n',  fontName='Helvetica', fontSize=9, leading=12.5, textColor=WARN,
                             backColor=colors.HexColor('#fffbeb'), borderColor=colors.HexColor('#fcd34d'),
                             borderWidth=0.6, borderPadding=(5, 6, 5, 6), spaceAfter=6),
    'cell':   ParagraphStyle('cl', fontName='Helvetica', fontSize=8.6, leading=11.5, textColor=INK),
    'cellb':  ParagraphStyle('cb', fontName='Helvetica-Bold', fontSize=8.6, leading=11.5, textColor=colors.white),
    'cellm':  ParagraphStyle('cm', fontName='Courier', fontSize=8.2, leading=11, textColor=INK),
    'toc':    ParagraphStyle('tc', fontName='Helvetica', fontSize=10, leading=16, textColor=INK, leftIndent=6),
}

def P(t, st='p'): return Paragraph(t, S[st])
def code(t): return Paragraph(t.replace('\n', '<br/>'), S['code'])
def bullets(items): return [Paragraph(f'<bullet>&bull;</bullet> {i}', S['li']) for i in items]
def h1(t): return [P(t, 'h1'), HRFlowable(width='100%', thickness=1, color=ACC, spaceAfter=6)]

def table(headers, rows, widths=None, mono_cols=()):
    data = [[Paragraph(h, S['cellb']) for h in headers]]
    for r in rows:
        data.append([Paragraph(c, S['cellm' if i in mono_cols else 'cell']) for i, c in enumerate(r)])
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    style = [
        ('BACKGROUND', (0, 0), (-1, 0), HEAD_BG),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#cbd5e1')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 3.5), ('BOTTOMPADDING', (0, 0), (-1, -1), 3.5),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style.append(('BACKGROUND', (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(style))
    return t

# ─── document ───────────────────────────────────────────────────────────────
def on_page(canv, doc):
    canv.saveState()
    if doc.page > 1:
        canv.setFont('Helvetica', 7.5)
        canv.setFillColor(colors.HexColor('#64748b'))
        canv.drawString(2 * cm, 1.15 * cm, 'AiBoO — Real Deployment & Test Guide  ·  v1.0  ·  Sep 2026')
        canv.drawRightString(A4[0] - 2 * cm, 1.15 * cm, f'Page {doc.page}')
        canv.setStrokeColor(colors.HexColor('#cbd5e1')); canv.setLineWidth(0.5)
        canv.line(2 * cm, 1.45 * cm, A4[0] - 2 * cm, 1.45 * cm)
    canv.restoreState()

doc = BaseDocTemplate(OUT, pagesize=A4,
                      leftMargin=2 * cm, rightMargin=2 * cm, topMargin=1.8 * cm, bottomMargin=1.9 * cm,
                      title='AiBoO — Real Deployment & Test Guide', author='AiBoO Platform')
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=on_page)])

E = []  # elements

# ═══ TITLE ═══
E += [Spacer(1, 3.2 * cm),
      P('AiBoO Security Platform', 'title'),
      P('Real Deployment &amp; Test Guide — run the full platform (no demo mode) on any system, and verify it end-to-end', 'sub'),
      Spacer(1, 0.5 * cm),
      HRFlowable(width='100%', thickness=2, color=ACC, spaceAfter=10),
      table(['Fact', 'Value'], [
          ['Repository', 'https://github.com/linux113/Aiboo'],
          ['Guide applies to', 'branch main (after PR #1 merge) or the provided feature branch'],
          ['Components run for real', 'MongoDB 7, Redis 7, Node backend (71 routes), Python agent API, web front door, React UI'],
          ['What is NOT demo', 'no in-memory store, no seeded fake keys — real secrets, real DB persistence'],
          ['One command', 'scripts/real-stack.sh up   (Linux / macOS / Git-Bash on Windows)'],
          ['Manual equivalent', 'Section 5 — any OS, incl. plain PowerShell'],
          ['Test suite inside', '10 end-to-end tests + 64-check smoke suite'],
      ], widths=[4.2 * cm, 12.6 * cm], mono_cols=()),
      Spacer(1, 0.4 * cm),
      P('Audience: engineers who receive this system and must run + demonstrate it on their own machine.', 'sub')]

# ═══ TOC ═══
E += h1('Contents')
toc = [
    '1.  Architecture — what runs where',
    '2.  Prerequisites per operating system',
    '3.  Get the code',
    '4.  One-command real run (real-stack.sh)',
    '5.  Manual run, any OS (Windows PowerShell walkthrough)',
    '6.  First login — admin bootstrap',
    '7.  End-to-end tests (T1–T10) with exact commands',
    '8.  Logs — every source, how to read them',
    '9.  Debugging in VS Code (hybrid mode)',
    '10. Troubleshooting table',
    '11. Security notes for the real run',
    'Appendix A — Environment variables reference',
    'Appendix B — API quick reference',
    'Appendix C — Port map &amp; file map',
    'Appendix D — Demo mode (only for presentations)',
]
E += [Paragraph(t, S['toc']) for t in toc]

# ═══ 1. ARCHITECTURE ═══
E += h1('1. Architecture — what runs where')
E += [P('The REAL stack replaces every demo shim with the genuine component. MongoDB and Redis run as '
        'docker containers bound to loopback only; the backend, agent API and web front door run as real '
        'host processes you (or VS Code) start; the React UI is built once and served same-origin by the '
        'web front door, which proxies API and websocket traffic — so there is no CORS and it works behind '
        'any tunnel or domain.')]
E += [table(['Component', 'Technology', 'Port', 'Role'], [
    ['MongoDB 7', 'docker container aiboo-mongodb', '27017 (127.0.0.1 only)', 'System of record — users, cameras, threats, incidents, audit. Persisted in docker volume mongo_data'],
    ['Redis 7', 'docker container aiboo-redis', '6379 (127.0.0.1 only)', 'Token blacklist + rate limiting shared store'],
    ['Backend API', 'Node 20+ / Express, process', '4000', '71 REST routes + socket.io realtime; JWT auth, zod validation, pino logs'],
    ['Agent API', 'Python / FastAPI, process', '8001', 'Ingestion &amp; zero-trust API for endpoint agents'],
    ['Web front door', 'backend/web.mjs, Node process', '5173', 'Serves frontend/dist; proxies /api + /socket.io -> :4000, /agent-api -> :8001 (mirrors production nginx)'],
    ['React UI', 'frontend/dist (built once)', 'via :5173', 'Dashboard, surveillance grid, SOAR, agent console, audit, settings'],
    ['CV service', 'Python, OPTIONAL (torch)', '5050', 'Real camera inference — optional; tests simulate it via the ingest API'],
], widths=[2.9 * cm, 4.1 * cm, 3.1 * cm, 6.7 * cm])]
E += [Spacer(1, 0.2 * cm),
      P('<b>Request path when you open the app:</b> browser -> http://localhost:5173 (web front door) -> '
        'static UI bundle; UI calls /api/* -> proxied to backend :4000; UI websocket /socket.io -> proxied '
        'with HTTP upgrade; agent console calls /agent-api/* -> proxied to :8001.', 'p')]

# ═══ 2. PREREQUISITES ═══
E += h1('2. Prerequisites per operating system')
E += [table(['Need', 'Windows 10/11', 'macOS', 'Linux'], [
    ['Docker', 'Docker Desktop (WSL2 backend), running', 'Docker Desktop or colima', 'docker engine + compose plugin'],
    ['Node.js', '20 LTS from nodejs.org', 'brew install node@20', 'nodesource or distro node 20+'],
    ['Python', '3.11+ from python.org (check "Add to PATH")', 'brew install python', 'python3 + pip'],
    ['bash (for the one-command script)', 'Git Bash — installed with Git for Windows (includes openssl)', 'built-in', 'built-in'],
    ['Git', 'git-scm.com', 'built-in after Xcode CLI tools', 'distro package'],
], widths=[3.4 * cm, 4.7 * cm, 4.3 * cm, 4.4 * cm])]
E += [Spacer(1, 0.15 * cm), P('<b>Version check (all OS):</b>')]
E += [code('docker --version        # must print, docker daemon running\ndocker compose version  # compose v2 plugin\nnode -v               # v20.x or v22.x\npython3 --version      # 3.11+\nopenssl version        # needed for secret generation')]

# ═══ 3. GET THE CODE ═══
E += h1('3. Get the code')
E += [code('git clone https://github.com/linux113/Aiboo.git\ncd Aiboo/aiboo-platform\n# stay on main, or checkout the branch you were given:\n# git checkout &lt;branch-name&gt;')]
E += [P('Everything below runs from <b>aiboo-platform/</b> (the folder containing docker-compose.yml, '
        'RUNBOOK.md, scripts/).')]

# ═══ 4. ONE COMMAND ═══
E += h1('4. One-command real run — scripts/real-stack.sh')
E += [P('Works on Linux, macOS, and Windows via <b>Git Bash</b> (open "Git Bash" from the Start menu, cd into '
        'the folder). The script is idempotent — safe to re-run any time; it skips what is already up.')]
E += [code('cd aiboo-platform\nscripts/real-stack.sh up')]
E += [P('<b>What the first run does, step by step (be patient — ~5-10 min):</b>')]
E += bullets([
    '<b>Secrets.</b> If backend/.env does not exist it is created from .env.example with four fresh '
    '<font face="Courier">openssl rand -hex 32</font> values: JWT_SECRET, AGENT_API_KEY, CV_INGEST_KEY, '
    'API_KEYS. File mode 600. The generated keys are printed once — save them.',
    '<b>Infrastructure.</b> <font face="Courier">docker compose --profile redis up -d mongodb redis</font> '
    '— real MongoDB 7 + Redis 7 containers, ports bound to 127.0.0.1 only. The script WAITS for both '
    'healthchecks to report healthy (up to 90 s).',
    '<b>Dependencies.</b> npm ci for backend and frontend, pip install for the agent, only if missing.',
    '<b>UI build.</b> If frontend/dist is absent: vite build with same-origin env '
    '(VITE_API_URL=/api, VITE_SOCKET_URL=, VITE_AGENT_URL=/agent-api, VITE_CV_URL=/cv-api).',
    '<b>Real processes.</b> Starts three host processes with nohup, each writing a pid + a log file: '
    'backend (node server.js, with REDIS_URL and LOG_FILE), agent (python run_api.py), web front door '
    '(node web.mjs). Existing live processes are reused, not duplicated.',
    '<b>Health gate.</b> Polls http://localhost:4000/health until OK, then prints the URL table.',
])
E += [P('<b>Expected final output:</b>')]
E += [code('[OK] mongodb healthy :27017 - redis healthy :6379\n[OK] backend started (pid 12345) -&gt; logs/backend.log\n[OK] agent API started (pid 12346) -&gt; logs/agent.log\n[OK] web front door started (pid 12347) -&gt; logs/web.log\n[OK] backend healthy :4000\n[OK] REAL STACK UP\n     UI        http://localhost:5173   (first registered user = admin)\n     API       http://localhost:4000   -  agent :8001\n     logs      tail -f logs/backend.log logs/agent.log logs/web.log')]
E += [P('<b>Daily commands:</b>')]
E += [code('scripts/real-stack.sh status   # health of backend/agent/web + docker healthchecks + log listing\nscripts/real-stack.sh logs     # tail -f all three service logs (Ctrl-C to exit)\nscripts/real-stack.sh down    # stop processes + mongo/redis containers (DATA VOLUMES ARE KEPT)')]

# ═══ 5. MANUAL RUN ═══
E += h1('5. Manual run, any OS — Windows PowerShell walkthrough')
E += [P('The exact equivalent of the script, command by command. Use this if you prefer separate terminals '
        '(recommended the first time — you see every log live) or if you do not want to use bash.')]
E += [P('<b>5.1 Secrets</b> — copy the example and generate real keys (PowerShell):', 'h2')]
E += [code('cd aiboo-platform\\backend\ncopy .env.example .env\n# generate 4 secrets (repeat for JWT_SECRET, AGENT_API_KEY, CV_INGEST_KEY, API_KEYS):\n-join ((1..64) | ForEach-Object { \'{0:x}\' -f (Get-Random -Max 16) })\n# paste each value into .env replacing the &lt;generate-with-openssl-rand-hex-32&gt; placeholder\n# (Git Bash / WSL / macOS/Linux users: openssl rand -hex 32)')]
E += [P('<b>5.2 Real infrastructure</b> — MongoDB + Redis in docker (any OS):', 'h2')]
E += [code('cd aiboo-platform\ndocker compose --profile redis up -d mongodb redis\ndocker ps   # wait until STATUS shows (healthy) for aiboo-mongodb and aiboo-redis')]
E += [P('<b>5.3 Backend</b> — terminal 1 (PowerShell env syntax shown):', 'h2')]
E += [code('cd aiboo-platform\\backend\nnpm ci\n$env:REDIS_URL = "redis://localhost:6379"\n$env:LOG_FILE  = "$PWD\\..\\logs\\backend.log"   # optional: mirror logs to a file\nmkdir ..\\logs -Force | Out-Null\nnode server.js\n# expect: "MongoDB connected" then "AiBoO Backend running on port 4000"')]
E += [P('<b>5.4 Agent API</b> — terminal 2:', 'h2')]
E += [code('cd aiboo-platform\\agent\npython -m pip install -r requirements.txt\npython run_api.py\n# expect: Uvicorn running on http://0.0.0.0:8001')]
E += [P('<b>5.5 UI build + web front door</b> — terminal 3 (build is once; later runs skip it):', 'h2')]
E += [code('cd aiboo-platform\\frontend\nnpm ci\n$env:VITE_API_URL="/api"; $env:VITE_SOCKET_URL=""; $env:VITE_AGENT_URL="/agent-api"; $env:VITE_CV_URL="/cv-api"\nnpx vite build\ncd ..\\backend\nnode web.mjs\n# expect: "web front door on :5173 -> backend http://127.0.0.1:4000, agent http://127.0.0.1:8001"')]
E += [P('<b>5.6 Open</b> http://localhost:5173', 'h2')]
E += [P('<b>Linux/macOS shorthand for each step:</b> export VITE_API_URL=/api VITE_SOCKET_URL= VITE_AGENT_URL=/agent-api VITE_CV_URL=/cv-api &amp;&amp; npx vite build  ·  REDIS_URL=redis://localhost:6379 LOG_FILE=../logs/backend.log node server.js  ·  python3 run_api.py  ·  node web.mjs')]

# ═══ 6. FIRST LOGIN ═══
E += h1('6. First login — admin bootstrap')
E += bullets([
    'Open http://localhost:5173 — you land on the login screen.',
    'Click Register. Create your account (name, email, password 8+ chars).',
    'The FIRST registered user automatically becomes ADMIN — this is the documented bootstrap '
    'mechanism; the role field in the register form is ignored by design.',
    'Everyone registering after gets the ANALYST role.',
    'Data survives restarts (MongoDB volume). If you ever wipe the volume, the next first-user is admin again.',
])
E += [P('<b>Token lifecycle:</b> access JWT 1 h, refresh token in an httpOnly cookie 7 d — the UI rotates '
        'it silently. If you change JWT_SECRET in backend/.env, all existing logins become invalid (by '
        'design) — just log in again.', 'p')]

# ═══ 7. TESTS ═══
E += h1('7. End-to-end tests — exact commands and expected results')
E += [P('Run these after the stack is up and you are logged in as admin. They walk the full detection -> '
        'correlation -> SOAR response chain against the REAL database. Keep the UI open in one window and '
        'run commands in the other — you will see the UI update live over the websocket.')]
E += [P('PowerShell users: replace curl -X POST -H ... with '
        '<font face="Courier">Invoke-RestMethod -Method Post -Uri &lt;url&gt; -Headers @{...} -ContentType \'application/json\' -Body \'...\'</font> '
        '(examples for T4 included; the pattern is identical elsewhere).', 'note')]

E += [P('T1 — Health of all three services', 'h2')]
E += [code('curl -s http://localhost:4000/health      # {"status":"ok",...}\ncurl -s http://localhost:8001/health     # {"status":"healthy","service":"AiBoO Ingestion..."}\ncurl -s -o NUL -w "%{http_code}" http://localhost:5173/   # 200   (Linux/macOS: -o /dev/null)')]

E += [P('T2 — Authentication issues a real JWT', 'h2')]
E += [code('curl -s -X POST http://localhost:4000/api/auth/login -H "content-type: application/json" \\\n  -d "{\'email\':\'YOUR@MAIL\',\'password\':\'YOURPASS\'}"\n# expect {"token":"eyJhbGciOiJIUzI1...","refreshToken":...} — copy the token:\nTOKEN=eyJ...   # paste; used as "authorization: Bearer $TOKEN" below')]
E += [P('Expected: a three-part JWT. Wrong password returns 401 Invalid credentials. Twenty auth calls in '
        '15 minutes from one IP trip the rate limiter (429) — that is correct behaviour.')]

E += [P('T3 — Add a camera (API + UI)', 'h2')]
E += [code('curl -s -X POST http://localhost:4000/api/cameras -H "authorization: Bearer $TOKEN" \\\n  -H "content-type: application/json" \\\n  -d "{\'name\':\'Lobby\',\'streamUrl\':\'rtsp://your-camera/stream\',\'location\':\'Building A\'}"\n# expect 201 with the created camera JSON (note the _id — used in T4)\ncurl -s http://localhost:4000/api/cameras -H "authorization: Bearer $TOKEN"\n# expect {"data":[...],"total":1,...}')]
E += [P('Required fields are <b>name</b> and <b>streamUrl</b>. In the UI the camera appears in the '
        'Surveillance grid immediately (socket event camera:added).')]

E += [P('T4 — CV detection ingest (simulates the camera vision service) with the real ingest key', 'h2')]
E += [code('# CV_INGEST_KEY is printed by real-stack.sh on first run, or: grep CV_INGEST_KEY backend/.env\ncurl -s -X POST http://localhost:4000/api/cameras/detections \\\n  -H "x-api-key: YOUR_CV_INGEST_KEY" -H "content-type: application/json" \\\n  -d "{\'cameraId\':\'CAMERA_ID_FROM_T3\',\'type\':\'weapon_knife\',\'severity\':\'critical\',\'confidence\':0.91}"\n# expect 201 + detection JSON; a critical threat "weapon..." is auto-created and pushed live')]
E += [code('# PowerShell variant:\nInvoke-RestMethod -Method Post -Uri http://localhost:4000/api/cameras/detections `\n  -Headers @{ "x-api-key" = "YOUR_CV_INGEST_KEY" } -ContentType "application/json" `\n  -Body \'{ "cameraId": "CAMERA_ID", "type": "weapon_knife", "severity": "critical", "confidence": 0.91 }\'')]
E += [P('Valid types include: person, vehicle, weapon, weapon_gun, weapon_knife, face_watchlist, fire, '
        'smoke, crowd, loitering, tamper, fall, tripwire (full list: backend/schemas/index.js). '
        'confidence accepts 0-1 (auto-normalised to %). Watch the UI: a critical notification pops and the '
        'threat lands in the Dashboard threat list within a second. A WRONG key returns 401 and is logged '
        'as a security warning — try it once to see the audit trail working.')]

E += [P('T5 — Endpoint agent reporting (finding + heartbeat) with the real agent key', 'h2')]
E += [code('curl -s -X POST http://localhost:4000/api/agent/findings -H "x-api-key: YOUR_AGENT_API_KEY" \\\n  -H "content-type: application/json" \\\n  -d "{\'agentId\':\'ws-finance-01\',\'type\':\'c2_beacon\',\'severity\':\'high\',\'description\':\'beacon every 60s\',\'host\':\'FIN-WS-12\'}"\ncurl -s -X POST http://localhost:4000/api/agent/heartbeat -H "x-api-key: YOUR_AGENT_API_KEY" \\\n  -H "content-type: application/json" \\\n  -d "{\'agentId\':\'ws-finance-01\',\'status\':\'healthy\',\'metrics\':{\'cpu\':22,\'mem\':48}}"\n# both expect 200/201; the finding appears live in the UI Agent Console')]

E += [P('T6 — Correlated event triggers a SOAR incident (playbook match)', 'h2')]
E += [code('curl -s -X POST http://localhost:4000/api/agent/correlated -H "authorization: Bearer $TOKEN" \\\n  -H "content-type: application/json" \\\n  -d "{\'event_type\':\'ransomware_prelude\',\'severity\':\'critical\',\'description\':\'mass file rename + shadow copy delete\',\'entity\':\'FIN-WS-12\'}"\n# expect 200; playbook "ransomware-prelude-containment" matches and creates a PENDING incident\ncurl -s "http://localhost:4000/api/soar/incidents?status=pending" -H "authorization: Bearer $TOKEN"\n# expect total &gt;= 1; note the incident _id for T7')]
E += [P('Why pending, not automatic: the shipped playbook has mode "approval" — human sign-off is '
        'required before any response action runs. (Playbooks: GET /api/soar/playbooks.)')]

E += [P('T7 — Approve the incident, actions execute', 'h2')]
E += [code('curl -s -X POST http://localhost:4000/api/soar/incidents/INCIDENT_ID/approve \\\n  -H "authorization: Bearer $TOKEN"\n# expect {"status":"executed","actions":[{"type":"isolate"},{"type":"lock_perimeter"},...]}\ncurl -s http://localhost:4000/api/dashboard/kpis -H "authorization: Bearer $TOKEN"\n#   totalActions grows by 2\ncurl -s http://localhost:4000/api/audit -H "authorization: Bearer $TOKEN"\n#   the audit trail contains soar.approve + the response actions, with your user id')]
E += [P('The same approval is available as a button in the UI SOAR section. Re-approving returns 409 '
        'Incident already executed — idempotency working.')]

E += [P('T8 — Persistence proof (this is what demo mode can never do)', 'h2')]
E += [code('scripts/real-stack.sh down\ndocker volume ls            # mongo_data still listed\ndocker ps                   # containers gone\nscripts/real-stack.sh up\ncurl -s http://localhost:4000/api/auth/login ... # SAME credentials still work\ncurl -s http://localhost:4000/api/soar/incidents -H "authorization: Bearer $TOKEN"\n#   the executed incident from T7 is still there')]
E += [P('Expected: login succeeds with the same account and every camera / threat / incident created in '
        'T3-T7 is still present — data lives in MongoDB, not in process memory.')]

E += [P('T9 — Automated smoke suite (64 checks)', 'h2')]
E += [code('cd aiboo-platform/backend\nnode smoke-test.mjs\n# expect final line: === 64 passed, 0 failed ===')]
E += [P('Covers: auth (register/login/refresh/rotate/logout/revocation), RBAC, camera + detection ingest, '
        'threats, agent endpoints, SOAR, validation errors, security headers, request-id propagation.')]

E += [P('T10 — Negative / security tests (do these too — they prove the guards)', 'h2')]
E += [code('# wrong service key -&gt; 401 + "Invalid API key attempt" warning in logs/backend.log\ncurl -s -X POST http://localhost:4000/api/agent/findings -H "x-api-key: bogus" ...\n# analyst cannot approve (403) - register a second user, try T7 with its token\n# tampered JWT -&gt; 401\ncurl -s http://localhost:4000/api/soar/incidents -H "authorization: Bearer abc.def.ghi"\n# schema validation -&gt; 400 with field-level issues\ncurl -s -X POST http://localhost:4000/api/cameras -H "authorization: Bearer $TOKEN" \\\n  -H "content-type: application/json" -d "{\'name\':\'x\'}"     # streamUrl required')]

E += [P('Test results checklist', 'h2')]
E += [table(['#', 'Test', 'Pass criteria', 'Pass?'], [
    ['T1', 'Health trio', '200/OK on 4000, 8001, 5173', ''],
    ['T2', 'Login + JWT', 'token returned; wrong pass 401', ''],
    ['T3', 'Camera create', '201; visible in UI grid', ''],
    ['T4', 'CV ingest + critical fan-out', '201; live threat + notification in UI', ''],
    ['T5', 'Agent finding + heartbeat', '201/200; Agent Console updates', ''],
    ['T6', 'Correlated -&gt; incident', 'pending incident created', ''],
    ['T7', 'Approve -&gt; executed', 'isolate + lock_perimeter; audit entries', ''],
    ['T8', 'Restart persistence', 'all data intact after down/up', ''],
    ['T9', 'Smoke suite', '64 passed, 0 failed', ''],
    ['T10', 'Negative tests', '401/403/400 as specified', ''],
], widths=[1 * cm, 5.2 * cm, 8.4 * cm, 1.6 * cm])]

# ═══ 8. LOGS ═══
E += h1('8. Logs — every source and how to read them')
E += [table(['Log', 'Where', 'Format'], [
    ['Backend (primary)', 'logs/backend.log when started via real-stack.sh or LOG_FILE set; otherwise stdout of the process', 'pino JSON lines, one per event'],
    ['Agent API', 'logs/agent.log (script) or the agent terminal', 'uvicorn/plain text'],
    ['Web front door', 'logs/web.log', 'startup + proxy errors'],
    ['MongoDB', 'docker logs aiboo-mongodb', 'mongod log'],
    ['Redis', 'docker logs aiboo-redis', 'redis log'],
    ['Security audit trail', 'GET /api/audit (admin JWT) or UI audit view; stored in MongoDB', 'who did what, when, target, metadata'],
    ['UI browser console', 'F12 in the browser', 'socket connect state, failed calls'],
], widths=[3.4 * cm, 8.2 * cm, 5.2 * cm])]
E += [Spacer(1, 0.15 * cm), P('<b>Annotated backend log line (JSON):</b>')]
E += [code('{"level":30,"time":1788453506630,"pid":9598,"reqId":"8978a8e2-...","msg":"POST /api/agent/heartbeat"}\n   |            |                    |                \\___ human-readable event\n   |            |                    \\____ per-request correlation id (echoed in every HTTP response as X-Request-Id)\n   |            \\____ epoch ms\n   \\____ 10=trace 20=debug 30=info 40=warn 50=error')]
E += [P('<b>Log level</b> is controlled by LOG_LEVEL in backend/.env (trace|debug|info|warn|error). '
        'LOG_FILE can point anywhere; the file sink is ADDED to stdout, nothing is lost. To follow '
        'everything: <font face="Courier">scripts/real-stack.sh logs</font>. For long-running machines, '
        'add logrotate on logs/*.log (or ship the JSON lines to your stack).')]

# ═══ 9. VSCODE ═══
E += h1('9. Debugging the real stack in VS Code (hybrid mode)')
E += bullets([
    'Open the aiboo-platform folder (it carries the tracked .vscode workspace).',
    'Start infra once: Terminal -&gt; Run Task -&gt; "aiboo: infra up (mongo+redis via Docker)".',
    'F5 -&gt; compound "Rocket — Real hybrid stack": launches Backend (dev), Agent (API mode) and Web front '
    'door together; breakpoints in backend JS and agent Python both hit; LOG_FILE and REDIS_URL are preset.',
    'Great demo breakpoint: backend/services/soar.service.js inside onCorrelatedAlert — fire T6 and watch '
    'the playbook match + incident creation step by step.',
    'Frontend: run task "aiboo: frontend dev (vite)" and the "Frontend (Chrome debug)" launch config to '
    'debug TSX with sourcemaps.',
    'Full walkthrough with screenshots-level detail: VSCODE_GUIDE.md in the repo.',
])

# ═══ 10. TROUBLESHOOTING ═══
E += h1('10. Troubleshooting')
E += [table(['Symptom', 'Cause', 'Fix'], [
    ['backend exits immediately: "production boot check failed"', 'JWT_SECRET missing/default/short', 'set a real openssl rand -hex 32 value in backend/.env'],
    ['"MongoServerSelectionError"', 'mongo container not up / not healthy yet', 'docker ps; docker logs aiboo-mongodb; wait for (healthy)'],
    ['connect ECONNREFUSED 127.0.0.1:6379 (warn only)', 'Redis not running; backend falls back to in-memory stores', 'docker compose --profile redis up -d redis; single-instance runs are fine without it'],
    ['Port already in use (4000/5173/27017)', 'another instance still running', 'scripts/real-stack.sh down; or kill the pid in logs/*.pid; lsof -i :4000'],
    ['UI loads, login works, but lists stay empty', 'dist built without same-origin env (or stale old build)', 'rebuild: see 5.5 — set all four VITE_* vars exactly, then npx vite build; hard-refresh (Ctrl+Shift+R)'],
    ['401 on every old session after redeploy', 'JWT_SECRET regenerated', 'log in again (tokens are signed with the secret)'],
    ['CV ingest 401', 'wrong x-api-key', 'use CV_INGEST_KEY from backend/.env (printed by real-stack.sh first run)'],
    ['Realtime updates not arriving', 'websocket blocked by a proxy in front of :5173', 'proxy must forward Upgrade for /socket.io (web.mjs already does; add the same to nginx)'],
    ['real-stack.sh: "docker not found" on Windows', 'ran in PowerShell — it needs bash', 'use Git Bash, or follow Section 5 manual steps'],
    ['npm ci fails on frontend', 'node version too old', 'node -v must be 20+'],
], widths=[5 * cm, 4.6 * cm, 7.2 * cm])]

# ═══ 11. SECURITY ═══
E += h1('11. Security notes for the real run')
E += bullets([
    'MongoDB and Redis are published on 127.0.0.1 ONLY — unreachable from other machines. Keep it that '
    'way; remote access belongs behind an authenticated reverse proxy.',
    'backend/.env holds live secrets: mode 600, never commit it (gitignored).',
    'All four service keys are compared timing-safe; wrong-key attempts are logged with source IP.',
    'First registered user = admin. On a shared machine, register immediately after first boot.',
    'Rate limiters: auth 20/15 min per IP, API 300/15 min, agent 600/15 min (tune in server.js).',
    'Every admin action (approvals, settings, user ops) lands in the immutable-style audit collection.',
    'For internet-facing demos: put the front door behind TLS (e.g. Caddy/nginx) and set TRUST_PROXY.',
])

# ═══ APPENDICES ═══
E += h1('Appendix A — Environment variables that matter')
E += [table(['Variable', 'Default', 'Meaning'], [
    ['MONGO_URI', 'mongodb://localhost:27017/aiboo', 'real DB connection'],
    ['REDIS_URL', 'unset (in-memory fallback)', 'set to redis://localhost:6379 in the real run'],
    ['JWT_SECRET', 'required, 32+ hex', 'signs all tokens — changing it invalidates sessions'],
    ['JWT_ACCESS_TTL / JWT_REFRESH_TTL', '1h / 7d', 'token lifetimes'],
    ['AGENT_API_KEY', 'required', 'x-api-key for /api/agent/* ingest (endpoint agents)'],
    ['CV_INGEST_KEY', 'required in prod', 'x-api-key for POST /api/cameras/detections (vision service)'],
    ['API_KEYS', 'comma list', 'x-api-key accepted on protect routes for services'],
    ['LOG_LEVEL / LOG_FILE', 'info / unset', 'verbosity; LOG_FILE mirrors all logs to a file'],
    ['CORS_ORIGINS', 'dev list', 'only needed for split-origin dev (vite :5174)'],
    ['SEED_DEMO_DATA', 'false', 'keep false for real runs'],
    ['RATE_LIMIT_DISABLED', 'unset', 'debug only — never in production'],
], widths=[4.6 * cm, 4.2 * cm, 8 * cm], mono_cols=(0,))]

E += h1('Appendix B — API quick reference (used by the tests)')
E += [table(['Method + Path', 'Auth', 'Purpose'], [
    ['GET  /health', 'none', 'liveness'],
    ['POST /api/auth/register | login | refresh | logout', 'none / JWT', 'first user becomes admin'],
    ['GET  /api/auth/me', 'JWT', 'current user'],
    ['GET/POST /api/cameras', 'JWT', 'name + streamUrl required'],
    ['POST /api/cameras/detections', 'x-api-key CV_INGEST_KEY', 'vision ingest; critical types fan out'],
    ['GET  /api/cameras/detections', 'JWT', 'recent detections'],
    ['GET/POST /api/threats', 'JWT', 'severity+title+source required; source enum'],
    ['GET/POST /api/assets', 'JWT', 'inventory; drives systemsMonitored KPI'],
    ['POST /api/agent/findings | heartbeat | correlated', 'x-api-key AGENT_API_KEY (correlated: JWT)', 'endpoint telemetry; correlated triggers SOAR'],
    ['GET  /api/soar/playbooks | incidents', 'JWT', 'incident ?status=pending filter'],
    ['POST /api/soar/incidents/:id/approve | reject', 'JWT admin', 'executes response actions'],
    ['GET  /api/dashboard/kpis', 'JWT', 'activeThreats, systemsMonitored, actions...'],
    ['GET  /api/audit', 'JWT admin', 'security audit trail'],
    ['GET  /api/docs', 'JWT (prod)', 'Swagger UI; spec at /api/docs.json'],
    ['GET  /health, /events (agent, :8001)', 'agent key', 'agent service endpoints (proxied at /agent-api)'],
], widths=[6.6 * cm, 3.6 * cm, 6.6 * cm], mono_cols=(0,))]

E += h1('Appendix C — Port map &amp; file map')
E += [table(['Port', 'Service', 'Bind'], [
    ['4000', 'Backend API + socket.io', '0.0.0.0 (host process)'],
    ['5173', 'Web front door (UI + proxy)', '0.0.0.0 (host process)'],
    ['8001', 'Agent API (FastAPI)', '0.0.0.0 (host process)'],
    ['27017', 'MongoDB 7', '127.0.0.1 ONLY (docker)'],
    ['6379', 'Redis 7', '127.0.0.1 ONLY (docker)'],
    ['5050', 'CV service (optional)', '0.0.0.0'],
], widths=[2 * cm, 8 * cm, 6.8 * cm], mono_cols=(0,))]
E += [Spacer(1, 0.2 * cm)]
E += [table(['File', 'What it is'], [
    ['scripts/real-stack.sh', 'one-command real stack (up/status/logs/down)'],
    ['backend/web.mjs', 'same-origin front door + proxy (real &amp; demo runs)'],
    ['backend/.env', 'live secrets (generated; gitignored)'],
    ['logs/backend.log, agent.log, web.log', 'service logs (LOG_FILE support)'],
    ['RUNBOOK.md', 'full operations manual (docker/K8s/ops)'],
    ['VSCODE_GUIDE.md', 'IDE debugging guide'],
    ['backend/demo/*', 'in-memory DEMO mode — presentations only, see Appendix D'],
], widths=[6.4 * cm, 10.4 * cm], mono_cols=(0,))]

E += h1('Appendix D — Demo mode (presentations only — NOT a real run)')
E += [P('For laptop demos with zero infrastructure there is an in-memory mode. It looks identical in the '
        'UI but holds data in process memory (wiped on restart) — use it only to show the screens:')]
E += [code('cd aiboo-platform/backend\nnode demo/boot.mjs &amp;      # API :4000 on the in-memory store\nnode web.mjs &amp;             # front door :5173\nnode demo/seed-demo.mjs     # admin@demo.io / Password123! + sample data')]
E += [P('Everything else in this guide (tests, logs, UI behaviour) applies the same way. If data survives a '
        'restart you are on the real stack; if it resets, you are in demo mode — that is the quickest way '
        'to tell them apart.')]
E += [Spacer(1, 0.3 * cm),
      HRFlowable(width='100%', thickness=1, color=ACC, spaceAfter=6),
      P('Generated from the repository state of branch arena/01a0678a-aiboo (commits ec57036/c7514a8). '
        'Regenerate this document: python3 scripts/make-run-guide-pdf.py', 'sub')]

doc.build(E)
print('WROTE', os.path.abspath(OUT))
