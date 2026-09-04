import logging
import os
from dataclasses import dataclass


INSECURE_DEFAULT_KEYS = {
    "dev-key-change-in-production",
    "internal-dev-key",
}


@dataclass
class AgentConfig:
    api_host: str = os.getenv("API_HOST", "0.0.0.0")
    api_port: int = int(os.getenv("API_PORT", "8001"))
    api_key: str = os.getenv("AGENT_API_KEY", "dev-key-change-in-production")
    internal_key: str = os.getenv("INTERNAL_API_KEY", "internal-dev-key")
    backend_url: str = os.getenv("NODE_BACKEND", "http://localhost:4000")
    backend_email: str = os.getenv("BACKEND_EMAIL", "admin@example.com")
    backend_password: str = os.getenv("BACKEND_PASSWORD", "admin123")
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    db_type: str = os.getenv("DB_TYPE", "memory")
    db_url: str = os.getenv("DATABASE_URL", "")
    event_ttl: int = int(os.getenv("EVENT_TTL_SECONDS", "3600"))
    max_dict_size: int = int(os.getenv("MAX_DICT_SIZE", "10000"))
    request_timeout: int = int(os.getenv("REQUEST_TIMEOUT", "30"))
    llm_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    llm_model: str = os.getenv("LLM_MODEL", "claude-3-haiku-20240307")
    rate_limit: int = int(os.getenv("RATE_LIMIT_PER_MINUTE", "60"))

    # Where this agent pushes findings / alerts.
    # Priority: REMOTE_URL env > NODE_BACKEND env > config.ini (read by orchestrator) > localhost.
    # NEVER hardcode a tunnel URL (ngrok etc.) — tunnels rotate and must be injected at runtime.
    remote_url: str = os.getenv(
        "REMOTE_URL", os.getenv("NODE_BACKEND", "http://localhost:4000")
    ).rstrip("/")

    endpoint_name: str = os.getenv("ENDPOINT_NAME", os.getenv("COMPUTERNAME", "Unknown_PC"))
    server_ip: str = os.getenv("SERVER_IP", "192.168.1.100")

    # Kill switches for engines that take real actions on the host.
    # Observability engines are safe to enable; action engines are opt-in.
    enable_command_dashboard: bool = os.getenv("ENABLE_COMMAND_DASHBOARD", "true").lower() == "true"
    enable_autonomous_response: bool = os.getenv("ENABLE_AUTONOMOUS_RESPONSE", "false").lower() == "true"
    enable_real_response: bool = os.getenv("ENABLE_REAL_RESPONSE", "false").lower() == "true"


config = AgentConfig()

if config.api_key == "dev-key-change-in-production":
    logging.warning(
        "AGENT_API_KEY is set to the development default 'dev-key-change-in-production' — "
        "CHANGE IT in production!"
    )
if config.internal_key == "internal-dev-key":
    logging.warning(
        "INTERNAL_API_KEY is set to the development default 'internal-dev-key' — "
        "CHANGE IT in production!"
    )

# Fail fast: refuse to run with known-default credentials in production.
if os.getenv("AIBOO_ENV", "").lower() == "production" or os.getenv("ENVIRONMENT", "").lower() == "production":
    _insecure = [name for name, val in (
        ("AGENT_API_KEY", config.api_key),
        ("INTERNAL_API_KEY", config.internal_key),
    ) if val in INSECURE_DEFAULT_KEYS]
    if _insecure:
        raise RuntimeError(
            f"Refusing to start in production with insecure default credentials: {', '.join(_insecure)}. "
            "Set real secrets via environment variables before deploying."
        )
