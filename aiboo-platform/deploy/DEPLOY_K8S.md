# Deploying AiBoO on Kubernetes (Helm)

The chart lives in `deploy/helm/aiboo`. One release per namespace
(component names are fixed: `aiboo-backend`, `aiboo-frontend`, …).

## 0. What the chart installs

| Component | Kind | Notes |
|---|---|---|
| frontend (nginx) | Deployment ×2 | same-origin proxy for `/api`, `/socket.io`, `/cv-api`, `/agent-api`; runs as uid 101 |
| backend | Deployment + **HPA** (2→6 @70% CPU) | `/health` probes; **crash-loops on default secrets by design** (boot guard) |
| agent | Deployment ×1 | full tri-gate (`RUN_ORCHESTRATOR=true`); SQLite queue on a PVC; action engines opt-in |
| cv | Deployment ×1 | `/health` probes; YOLO weights on a PVC; optional `cv.gpu.enabled=true` |
| mongo (optional) | StatefulSet + headless svc | disable + `backend.mongoUri` for Atlas/DocumentDB |
| redis (optional) | Deployment + PVC | revocation/rate-limits/socket fan-out; disable = in-memory fallback |
| ingress | nginx class by default | one rule → frontend (frontend proxies everything internally) |
| secret | created from values OR bring-your-own | `auth.createSecret` / `auth.secretName` |

## 1. Quick start (kind/minikube demo)

```bash
# images from local docker build (kind loads them into the cluster)
docker compose build          # builds aiboo-backend/frontend/agent/cv images
kind create cluster --name aiboo
kind load docker-image aiboo-backend aiboo-frontend aiboo-agent aiboo-cv --name aiboo

helm upgrade --install aiboo deploy/helm/aiboo \
  --namespace aiboo --create-namespace \
  --set auth.createSecret=true \
  --set auth.jwtSecret=$(openssl rand -hex 32) \
  --set auth.agentApiKey=$(openssl rand -hex 32) \
  --set auth.internalApiKey=$(openssl rand -hex 32) \
  --set auth.apiKeys=$(openssl rand -hex 32) \
  --set auth.cvIngestKey=$(openssl rand -hex 32) \
  --set auth.cvAuthToken=$(openssl rand -hex 32) \
  --set ingress.host=aiboo.local

kubectl -n aiboo rollout status deploy/aiboo-backend
# port-forward for local testing:
kubectl -n aiboo port-forward svc/aiboo-frontend 8080:5173
# → http://localhost:8080  (Swagger: /api/docs)
```

## 2. Production checklist

**Secrets — don't bake them into values.** Create externally, then:
```bash
kubectl -n aiboo create secret generic aiboo-secrets \
  --from-literal=jwtSecret=$(openssl rand -hex 32) \
  --from-literal=agentApiKey=$(openssl rand -hex 32) \
  --from-literal=internalApiKey=$(openssl rand -hex 32) \
  --from-literal=apiKeys=$(openssl rand -hex 32) \
  --from-literal=cvIngestKey=$(openssl rand -hex 32) \
  --from-literal=cvAuthToken=$(openssl rand -hex 32)

helm upgrade --install aiboo deploy/helm/aiboo -n aiboo \
  --set auth.createSecret=false --set auth.secretName=aiboo-secrets \
  --set ingress.host=soc.example.com \
  --set ingress.tls.enabled=true --set ingress.tls.secretName=soc-tls \
  -f prod-values.yaml
```
(Even better: ExternalSecrets/SealedSecrets → same key names. The backend
boot guard still verifies the loaded values at startup.)

**Managed database** — set `mongo.enabled=false` and
`--set backend.mongoUri="mongodb+srv://…/aiboo"`.

**Scaling** — HPA ships enabled for the backend (needs metrics-server).
Keep `agent.replicas=1` per namespace (single orchestrator); scale CV by
`cv.replicas` with camera partitioning, or enable `cv.gpu.enabled=true`
(requires the NVIDIA device plugin; pairs with a TensorRT build of the image).

**Multi-instance websockets** — keep `redis.enabled=true` so Socket.IO
fan-out works across backend replicas.

**Validate the chart** (no helm needed — used in pre-commit too):
```bash
python3 deploy/helm/validate-templates.py deploy/helm/aiboo
helm lint deploy/helm/aiboo && helm template deploy/helm/aiboo > /dev/null  # if helm installed
```

## 3. Upgrades / rollback

```bash
helm upgrade aiboo deploy/helm/aiboo -n aiboo --reuse-values --set backend.tag=v1.1.0
helm rollback aiboo 0 -n aiboo
```
Detection data retention (90-day TTL) and audit logs live in Mongo —
upgrades are stateless for the app tier.
