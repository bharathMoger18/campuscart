#!/bin/bash
# ============================================================
# entrypoint.sh — CampusCart Django startup script
#
# This script runs EVERY TIME the web container starts.
# It ensures migrations are applied before Daphne starts.
# ============================================================

set -e  # Exit immediately if any command fails

echo "🔄 Waiting for database to be ready..."
# We already use depends_on: condition: service_healthy
# But adding explicit wait here as extra safety
until python manage.py showmigrations --plan 2>/dev/null | head -1; do
    echo "⏳ Database not ready yet, waiting 2 seconds..."
    sleep 2
done

echo "✅ Database is ready!"

echo "🔄 Running database migrations..."
python manage.py migrate --noinput

echo "✅ Migrations complete!"

echo "🚀 Starting Daphne ASGI server..."
# -b 0.0.0.0: bind to all interfaces (not just loopback)
# -p 8000: listen on port 8000
# campuscart.asgi:application: the ASGI app object
exec daphne -b 0.0.0.0 -p 8000 campuscart.asgi:application
