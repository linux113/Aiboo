# EDR Architecture Alignment — spec (PDF) vs implementation

Source: `EDR Architecture.pdf` (repo root, 15 pages) · Reviewed: 2026-09-03

The PDF defines two things: (1) the generic EDR loop — *endpoint sensor →
telemetry → cloud platform → detect/correlate → console → respond → back to
endpoint* — and (2) the AiBoO-specific design — *Event Bus → specialist
agents → Correlation Engine → CorrelatedAlert → Dashboard + Response Engine,
with the Python security engine kept strictly separate from the MERN stack.*

## 1. The EDR loop (PDF §1) vs Aiboo today

| Spec stage | Implementation | Status |
|---|---|---|
| Endpoint agent/sensor (processes, files, network, sys changes) | `agent/` ProcessMonitor, WindowsEventIngestor (Security/System/App logs), CyberThreatAgent memory scanning; `plugin/agent.ps1` Windows installer | ✅ Windows endpoints; ❌ no Linux/macOS sensor |
| Telemetry → central platform | HTTP `POST /api/agent/findings` + heartbeats; SQLite offline queue with retry | ✅ |
| Ingest / normalize / store / enrich | Zod validation, Mongo write-through + rehydration, **threat-intel enrichment** (AbuseIPDB/VT/MISP, IoC extraction) | ✅ |
| Detection: IOC/signatures | ThreatIntelligenceEngine + `intel.service.js` lookups on findings | ✅ |
| Detection: behavioural / ML | BehavioralDNA, UEBA, AnomalyDetection, InsiderThreat, risk scoring (deterministic — as the PDF mandates) | ✅ |
| Event correlation (PDF: 30s sliding window) | CorrelationEngine + MetaRiskArbiter + ConvergedSecurityEngine (Layer 3 cyber-physical) | ✅ |
| Threat intelligence feed | Phase 4 intel service + engine | ✅ |
| Security console (alert, severity, timeline, investigation) | React SOC dashboard, live sockets, audit trail, Swagger API | ✅ |
| Response: kill / quarantine / isolate / remediate | ProcessKiller (opt-in), PseudoLock, `/api/respond/*` actions, **SOAR playbooks with approval gates** | ✅ (human-gated by default) |
| **Response command sent BACK to the endpoint** | Backend→agent service calls exist (e.g. pseudo-lock restore), but **remote endpoints have no persistent command channel** — they only push | ⬜ **the main gap** (see §3.1) |

## 2. The AiBoO design decisions (PDF §2) vs reality

| Spec decision | Implementation | Status |
|---|---|---|
| ThreatEvent standard format on an Event Bus | `core/events.py` dataclasses + EventBus (now fault-isolated per subscriber) | ✅ |
| Specialist agents (Cyber, Identity, Surveillance, Pseudo-Lock) | 7 agents — the 4 specced + ZeroTrust, Phishing, MalwareAnalysis | ✅ superset |
| AgentFinding = structured output (finding, confidence, recommended action) | `AgentFinding` schema, Zod-validated at ingest, persisted | ✅ |
| CorrelatedAlert fans out to Dashboard **and** Response Engine simultaneously | `emitCritical()` funnel → sockets + notification fabric + `onCorrelatedAlert()` SOAR hook | ✅ |
| Python engine separate from MERN; API boundary only | Separate service/container/pod; HTTP + API-key boundary; never embedded | ✅ |
| MVP transport: Python → HTTP API → Express → Mongo → React | Exactly the running topology | ✅ |
| Production transport: queue (Redis/RabbitMQ) between engine and backend | HTTP today; Redis used inside the backend tier (blacklist/limits/socket fan-out) but **not** as the agent↔backend queue | ◐ pending |
| Cloud = where the central platform runs | Docker Compose + Helm/K8s chart (HPA, probes, BYO-DB) | ✅ |
| **LLM NOT required for core detection** (rules/thresholds/scoring/correlation); optional explain-layer | Core is fully deterministic; LLM lives only in NarrativeAgent/ThreatHypothesis + `/api/ai` explain/chat (optional, key-gated, heuristic fallback) | ✅ matches the spec's intent |

## 3. Gaps the PDF exposes (prioritized)

1. **Reverse command channel (close the EDR loop).** The PDF's final step —
   *response command sent back through the EDR agent* — only half-exists:
   endpoints push findings, but isolating/killing/unlocking a **remote**
   endpoint relies on the backend reaching the agent service, not the
   endpoint. Fix options: (a) agent long-polls a command endpoint
   (`GET /api/agent/commands?since=`) using its existing API key — simplest,
   works behind NAT; (b) websocket command channel; (c) message queue
   (Redis Streams) which also satisfies §2's production-transport note.
2. **Cross-platform sensor.** Windows-only today (pywin32). Linux server
   coverage needs journald/auditd ingest; the API ingestion path already
   accepts events from any source, so this is a sensor-pack, not a redesign.
3. **Agent↔backend queue** for scale/burst absorption (Redis Streams or
   RabbitMQ) — replaces plain HTTP POST at high event volume.

None of these block the current deployment story; they are the next
architectural increments if Aiboo is to behave as a full EDR rather than a
SOC platform with endpoint push-telemetry.
