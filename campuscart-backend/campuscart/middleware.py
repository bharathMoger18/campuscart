# campuscart/middleware.py
import jwt
from django.conf import settings
from urllib.parse import parse_qs
from channels.db import database_sync_to_async

from django.contrib.auth import get_user_model

@database_sync_to_async
def get_user(user_id):
    User = get_user_model()  # ← moved inside
    try:
        return User.objects.get(id=user_id)
    except User.DoesNotExist:
        return None


class JWTAuthMiddleware:
    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        query_string = scope["query_string"].decode()
        params = parse_qs(query_string)
        token = params.get("token", [None])[0]

        if token:
            try:
                payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
                scope["user"] = await get_user(payload.get("user_id"))
            except Exception:
                scope["user"] = None
        else:
            scope["user"] = None

        return await self.inner(scope, receive, send)

def JWTAuthMiddlewareStack(inner):
    from channels.auth import AuthMiddlewareStack
    return JWTAuthMiddleware(AuthMiddlewareStack(inner))
