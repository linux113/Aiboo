#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
# real-stack.sh — AiBoO REAL stack, one command. No demo shims.
#
#   scripts/real-stack.sh up      mongo+redis (docker) + backend + agent
#                               + web front door, logs → logs/*.log
#   scripts/real-stack.sh status  health of every component
#   scripts/real-stack.sh logs    tail -f all log files (Ctrl-C to exit)
#   scripts/real-stack.sh down    stop services (data volumes are KEPT)
#
# Requirements: docker, node 20+, python3, openssl. First run installs
# deps and generates backend/.env with real random secrets.
# ══════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
MODE="${1:-up}"
C_OK="\\033[32m✔\\033[0m"; C_INFO="\\033[36m▸\\033[0m"; C_ERR="\\033[31m✖\\033[0m"

say()  { printf "%b %s\\n" "$1" "$2"; }
die()  { printf "%b %s\\n" "$C_ERR" "$1" >&2; exit 1; }

wait_healthy() { # container seconds
  local n=0
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$1" 2>/dev/null || echo starting)" = "healthy" ]; do
    n=$((n+1)); [ $n -gt "$2" ] && die "$1 not healthy after ${2}s (docker logs $1)"
    sleep 1
  done
}

pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

case "$MODE" in
up)
  command -v docker >/dev/null || die "docker not found — install Docker Desktop first"
  command -v openssl >/dev/null || die "openssl not found"

  # ── env: real secrets, generated once ─────────────────────────────
  if [ ! -f backend/.env ]; then
    say "$C_INFO" "generating backend/.env with fresh random secrets"
    JWT=$(openssl rand -hex 32); AGENT_K=$(openssl rand -hex 32)
    CV_K=$(openssl rand -hex 32); API_K=$(openssl rand -hex 32)
    sed -e "s|<generate-with-openssl-rand-hex-32>|$JWT|g" \
        -e "s|AGENT_API_KEY=.*|AGENT_API_KEY=$AGENT_K|" \
        -e "s|CV_INGEST_KEY=.*|CV_INGEST_KEY=$CV_K|" \
        -e "s|API_KEYS=.*|API_KEYS=$API_K|" \
        backend/.env.example > backend/.env
    chmod 600 backend/.env
    say "$C_OK" "backend/.env created (agent key: $AGENT_K)"
  fi

  # ── infra: REAL mongodb + redis in docker (loopback-only ports) ──
  say "$C_INFO" "starting mongodb + redis (docker)…"
  docker compose --profile redis up -d mongodb redis >/dev/null
  wait_healthy aiboo-mongodb 90
  wait_healthy aiboo-redis 30
  say "$C_OK" "mongodb healthy :27017 · redis healthy :6379"

  # ── deps ──────────────────────────────────────────────────────────
  [ -d backend/node_modules ] || { say "$C_INFO" "installing backend deps"; npm --prefix backend ci --omit=dev >/dev/null; }
  [ -d frontend/node_modules ] || { say "$C_INFO" "installing frontend deps"; npm --prefix frontend ci --omit=dev >/dev/null; }
  python3 -c "import fastapi" 2>/dev/null || { say "$C_INFO" "installing agent deps"; python3 -m pip install -q -r agent/requirements.txt; }

  # ── frontend: same-origin build ───────────────────────────────────
  if [ ! -f frontend/dist/index.html ]; then
    say "$C_INFO" "building frontend (same-origin)…"
    (cd frontend && VITE_API_URL=/api VITE_SOCKET_URL= VITE_AGENT_URL=/agent-api VITE_CV_URL=/cv-api npx vite build >/dev/null)
  fi

  # ── processes: real backend + agent + web, logs to files ──────────
  mkdir -p logs
  if ! pid_alive logs/backend.pid; then
    ( cd backend && REDIS_URL=redis://localhost:6379 LOG_FILE="$ROOT/logs/backend.log" \
        nohup node server.js > /dev/null 2>&1 & echo $! > "$ROOT/logs/backend.pid" )
    say "$C_OK" "backend started (pid $(cat logs/backend.pid)) → logs/backend.log"
  else say "$C_INFO" "backend already running (pid $(cat logs/backend.pid))"; fi

  if ! pid_alive logs/agent.pid; then
    ( cd agent && nohup python3 -u run_api.py > "$ROOT/logs/agent.log" 2>&1 & echo $! > "$ROOT/logs/agent.pid" )
    say "$C_OK" "agent API started (pid $(cat logs/agent.pid)) → logs/agent.log"
  else say "$C_INFO" "agent already running (pid $(cat logs/agent.pid))"; fi

  if ! pid_alive logs/web.pid; then
    ( cd backend && nohup node web.mjs > "$ROOT/logs/web.log" 2>&1 & echo $! > "$ROOT/logs/web.pid" )
    say "$C_OK" "web front door started (pid $(cat logs/web.pid)) → logs/web.log"
  else say "$C_INFO" "web already running (pid $(cat logs/web.pid))"; fi

  # ── wait for backend health ───────────────────────────────────────
  for i in $(seq 1 30); do
    curl -sf http://localhost:4000/health >/dev/null 2>&1 && break
    [ $i -eq 30 ] && die "backend not healthy — check logs/backend.log"
    sleep 1
  done
  say "$C_OK" "backend healthy :4000"

  echo
  say "$C_OK" "REAL STACK UP — MongoDB 7 + Redis 7 + backend + agent + web"
  echo    "     UI        http://localhost:5173   (first registered user = admin)"
  echo    "     API       http://localhost:4000   ·  agent :8001"
  echo    "     logs      tail -f logs/backend.log logs/agent.log logs/web.log"
  echo    "               mongo: docker logs aiboo-mongodb"
  ;;

down)
  for p in logs/backend.pid logs/agent.pid logs/web.pid; do
    if pid_alive "$p"; then kill "$(cat "$p")" && say "$C_OK" "stopped $(basename "$p" .pid) ($(cat "$p"))"; fi
    rm -f "$p"
  done
  docker compose stop mongodb redis >/dev/null 2>&1 && say "$C_OK" "mongo+redis stopped (volumes kept)"
  ;;

status)
  for s in "backend:http://localhost:4000/health" "agent:http://localhost:8001/health" "web:http://localhost:5173/"; do
    n="${s%%:*}"; u="${s#*:}"
    if curl -sf --max-time 3 "$u" >/dev/null 2>&1; then say "$C_OK" "$n up ($u)";
    else say "$C_ERR" "$n DOWN"; fi
  done
  for c in aiboo-mongodb aiboo-redis; do
    say "$C_OK" "$c: $(docker inspect -f '{{.State.Health.Status}}' "$c" 2>/dev/null || echo stopped)"
  done
  echo "log files:"; ls -la logs/*.log 2>/dev/null || echo "  (none)"
  ;;

logs)
  [ -f logs/backend.log ] || die "no logs yet — run scripts/real-stack.sh up"
  tail -f logs/backend.log logs/agent.log logs/web.log
  ;;

*) die "usage: scripts/real-stack.sh up|down|status|logs" ;;
esac
