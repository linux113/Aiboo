"""
utils/logging_setup.py — Unicode-safe logging bootstrap for AiBoO agent.

Why this exists:
    On Windows the default console/stdout encoding is cp1252. Engine logs
    contain Unicode (em-dashes '—', check-marks '✅', arrows '→', …), and any
    attempt to write them to a cp1252 stream raises
    `UnicodeEncodeError: 'charmap' codec can't encode character`, which
    previously crashed three engines (CommandDashboard, AutonomousResponse,
    RealResponse) and forced them to be disabled.

Fix:
    Reconfigure stdout/stderr to UTF-8 with errors='replace' BEFORE any
    logging handler is attached, then install a formatter-safe handler.
    On Python < 3.7 fallback to wrapping the stream.

Usage (first line of any entrypoint):
    from utils.logging_setup import configure_logging
    configure_logging(level="INFO")
"""

from __future__ import annotations

import logging
import os
import sys

_CONFIGURED = False


def _reconfigure_streams() -> None:
    """Make stdout/stderr tolerate arbitrary Unicode regardless of platform."""
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is None:
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
                continue
            except (ValueError, OSError):
                pass  # fall through to wrapper
        # Python < 3.7 or exotic stream: wrap it
        import io
        import functools

        try:
            wrapped = io.TextIOWrapper(
                stream.buffer, encoding="utf-8", errors="replace", line_buffering=True
            )
            setattr(sys, stream_name, wrapped)
        except AttributeError:
            pass


def configure_logging(level: str = "INFO", name: str = "aiboo") -> None:
    """Bootstrap Unicode-safe logging. Idempotent — safe to call from every entrypoint."""
    global _CONFIGURED
    _reconfigure_streams()

    # Belt & braces for child processes / handlers created later.
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    if not _CONFIGURED:
        handler = logging.StreamHandler(stream=sys.stderr)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s [%(levelname)s] %(name)s — %(message)s",
                datefmt="%H:%M:%S",
            )
        )
        root = logging.getLogger()
        root.handlers = [handler]
        _CONFIGURED = True

    lvl = getattr(logging, str(level).upper(), logging.INFO)
    logging.getLogger().setLevel(lvl)
    logging.getLogger(name).debug("Logging configured (utf-8, errors=replace)")
