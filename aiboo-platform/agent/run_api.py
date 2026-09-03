"""
Run AiBoO with FastAPI Ingestion Layer ONLY
No Windows Event Log ingestion - just API endpoint for external agents
"""

import asyncio
import logging
import signal
import sys
import os
import threading

sys.path.insert(0, os.path.dirname(__file__))

import uvicorn

from core.event_bus import EventBus
from core.events import ThreatEvent, ThreatType, Severity
from api.ingestion_api import create_app
from core.config import config

# UTF-8-safe logging FIRST (fixes cp1252 UnicodeEncodeError on Windows consoles)
from utils.logging_setup import configure_logging

configure_logging(level=config.log_level)

logging.getLogger("WindowsIngestor").setLevel(logging.WARNING)
logging.getLogger("Gate1.Perimeter").setLevel(logging.INFO)
logging.getLogger("CyberThreatAgent").setLevel(logging.INFO)

log = logging.getLogger("runner")

event_bus = EventBus()
_shutdown_requested = False
_orchestrator = None


def handle_signal(signum, frame):
    global _shutdown_requested
    if _shutdown_requested:
        log.warning("Forced exit")
        sys.exit(1)
    _shutdown_requested = True
    log.warning("Received signal %s, shutting down gracefully...", signum)


class SimplePrintAgent:
    def __init__(self, bus: EventBus):
        self.bus = bus
        self.name = "PrintAgent"
        bus.subscribe(ThreatEvent, self.handle)

    async def handle(self, event: ThreatEvent):
        log.info(
            "Agent received event: id=%s source=%s type=%s severity=%s message=%s",
            event.event_id, event.source, event.threat_type.value,
            event.severity.value, event.payload.get('message', 'No message')
        )


def run_api_server():
    app = create_app(event_bus)
    log.info("API Server starting on http://localhost:%s", config.api_port)
    uvicorn.run(app, host="0.0.0.0", port=config.api_port, log_level="warning")


async def run_agents():
    print_agent = SimplePrintAgent(event_bus)
    log.info("PrintAgent active")

    # Optionally run the FULL orchestrator (tri-gate + engines + bridge) inside
    # the container. Enabled with RUN_ORCHESTRATOR=true — this is what production
    # deployments want; the bare API-only mode remains the default for dev/tests.
    if os.getenv("RUN_ORCHESTRATOR", "false").lower() == "true":
        from core.orchestrator import Orchestrator
        log.info("RUN_ORCHESTRATOR=true — starting full tri-gate orchestrator")
        orchestrator = Orchestrator(event_bus)
        await orchestrator.start()
        global _orchestrator
        _orchestrator = orchestrator

    try:
        while not _shutdown_requested:
            await asyncio.sleep(1)
    except (KeyboardInterrupt, asyncio.CancelledError):
        log.warning("Shutdown requested")
    finally:
        if _orchestrator is not None:
            try:
                await _orchestrator.shutdown()
            except Exception as exc:
                log.warning("Orchestrator shutdown error: %s", exc)


async def main():
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    api_thread = threading.Thread(target=run_api_server, daemon=True)
    api_thread.start()

    await run_agents()

    log.info("Shutdown complete.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.warning("Interrupted by user.")
