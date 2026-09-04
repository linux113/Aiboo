# UTF-8 everywhere; non-root; queue dir on a volume mount point.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

# Non-root runtime; /app/queue is the volume mount point (ALERT_QUEUE_DB_PATH)
RUN useradd -m -u 1000 appuser \
    && mkdir -p /app/queue \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8001
# API-only default; set RUN_ORCHESTRATOR=true (K8s values / compose) for full tri-gate.
CMD ["python", "run_api.py"]
