# ============================================================
# Dockerfile — CampusCart Django Backend
# Base: python:3.10-slim (matches your system Python 3.10.12)
# Server: Daphne (ASGI — required for WebSockets/Channels)
# ============================================================

# ── Layer 1: Base Image ──────────────────────────────────────
# python:3.10-slim is Debian Bookworm with Python 3.10 pre-installed
# 'slim' variant = no extra packages, ~120MB vs ~900MB for full image
# We use 3.10 to exactly match your Ubuntu system Python 3.10.12
FROM python:3.10-slim

# ── Layer 2: System Dependencies ─────────────────────────────
# These are OS-level packages Python packages need to compile/run
# We install them with apt-get (Debian package manager)
#
# Why these packages?
#   build-essential  → C compiler (gcc) — needed to compile psycopg2, cryptography
#   libpq-dev        → PostgreSQL client headers — psycopg2 needs this
#   libpq5           → PostgreSQL client runtime library
#   curl             → used in health checks
#
# Best practice: combine all apt-get commands in ONE RUN instruction
# Each RUN = one layer. Fewer layers = smaller image, faster pulls.
# 'rm -rf /var/lib/apt/lists/*' clears apt cache — saves ~50MB in image
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Layer 3: Working Directory ────────────────────────────────
# All subsequent commands run from /app inside the container
# This is the "home" of your Django project inside the image
# Think of it like: cd /app
WORKDIR /app

# ── Layer 4: Python Dependencies (CACHED LAYER) ───────────────
# CRITICAL BUILD OPTIMIZATION — Read this carefully:
#
# We copy ONLY requirements.txt first (not all code).
# Then we run pip install.
#
# Docker caches each layer. If requirements.txt hasn't changed,
# Docker reuses the cached pip install layer on next build.
# This saves 3-5 minutes on every code change build.
#
# If we did COPY . . first, any code change would invalidate
# this layer and re-run pip install every single time. Bad!
#
# --no-cache-dir: don't store pip's download cache in image
# This saves ~100MB of unnecessary cached wheels in the image
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# ── Layer 5: Application Code ─────────────────────────────────
# NOW we copy all code (after pip install is cached above)
# The . refers to build context (campuscart-backend/ directory)
# .dockerignore already excluded: venv/, .env, media/, staticfiles/
COPY . .

# ── Layer 6: Static Files ─────────────────────────────────────
# collectstatic copies all static files (CSS, JS for Django admin,
# DRF browsable API, drf-spectacular docs) into STATIC_ROOT.
#
# In settings.py: STATIC_ROOT = BASE_DIR / "staticfiles"
# So this creates /app/staticfiles/ inside the image.
#
# --noinput: don't ask for confirmation (we're in automated build)
#
# Why run this at build time, not runtime?
# Static files don't change per-request. Baking them into the
# image means every container replica has them ready immediately.
# No need to run collectstatic on every container start.
#
# We set minimal env vars just for this build step.
# The real secrets come from docker-compose at runtime.
RUN DJANGO_SECRET_KEY=build-time-placeholder-not-real \
    DB_HOST=placeholder \
    DB_NAME=placeholder \
    DB_USER=placeholder \
    DB_PASSWORD=placeholder \
    REDIS_HOST=placeholder \
    python manage.py collectstatic --noinput

# ── Layer 7: Port Documentation ───────────────────────────────
# EXPOSE is documentation only — it doesn't actually open the port.
# It tells Docker and developers: "this container listens on 8000"
# The actual port mapping happens in docker-compose.yml
EXPOSE 8000

# ── Layer 8: Start Command ────────────────────────────────────
# We use Daphne (not Gunicorn) because:
# - Your project has Django Channels (WebSockets for chat/push)
# - Gunicorn is WSGI — it cannot handle WebSocket connections
# - Daphne is ASGI — handles both HTTP and WebSocket connections
#
# -b 0.0.0.0 → Bind to ALL interfaces inside container
#   WHY NOT 127.0.0.1?
#   127.0.0.1 = loopback = only accessible from WITHIN the container
#   0.0.0.0 = all interfaces = accessible from OTHER containers
#   Nginx container needs to reach Django container → must use 0.0.0.0
#
# -p 8000 → listen on port 8000
#
# campuscart.asgi:application → the ASGI app object
#   campuscart/ is your Django project directory
#   asgi.py defines the 'application' object
# CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "campuscart.asgi:application"]
CMD ["bash", "entrypoint.sh"]
