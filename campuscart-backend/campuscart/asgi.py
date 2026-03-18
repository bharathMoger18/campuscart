# campuscart/asgi.py
import os
import django
from django.conf import settings
from django.core.asgi import get_asgi_application
from django.contrib.staticfiles.handlers import ASGIStaticFilesHandler
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "campuscart.settings")
django.setup()

import chat.routing
import push.routing

# Combine WebSocket routes
combined_websocket_routes = chat.routing.websocket_urlpatterns + push.routing.websocket_urlpatterns

# Get default ASGI app
django_asgi_app = get_asgi_application()

# ✅ Wrap static files handler in DEBUG mode (for dev)
if settings.DEBUG:
    django_asgi_app = ASGIStaticFilesHandler(django_asgi_app)

# Final ASGI application
application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AuthMiddlewareStack(
        URLRouter(combined_websocket_routes)
    ),
})
