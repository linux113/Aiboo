# Requires .dockerignore in same directory to exclude __pycache__, .env, etc.
FROM python:3.11-slim

# UTF-8 everywhere — engines log Unicode symbols and the default POSIX locale
# of slim images (ascii/cp1252-style failures) previously crashed them.
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

EXPOSE 8001

# API-only mode by default. For the full tri-gate orchestrator inside the
# container set RUN_ORCHESTRATOR=true (docker-compose overrides this CMD
# with the same entrypoint + flag when needed).
CMD ["python", "run_api.py"]
