# push/consumers.py
import json
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from urllib.parse import parse_qs
from rest_framework_simplejwt.authentication import JWTAuthentication
from push.models import PushNotification

User = get_user_model()


class NotificationsConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        """Authenticate user via ?token=<JWT> and join personal group."""
        self.user = await self.get_user_from_token()
        if not self.user:
            await self.close(code=4001)
            return

        self.room_group_name = f"user_notifications_{self.user.id}"
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        await self.send_json({"status": "connected", "user": self.user.email})

    async def disconnect(self, code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        """Client can request {type: 'fetch'} to load recent notifications."""
        if content.get("type") == "fetch":
            notifications = await self.get_recent_notifications()
            await self.send_json({"type": "notifications_list", "notifications": notifications})

    async def notification_event(self, event):
        """Receive broadcast event from backend push logic."""
        await self.send_json({"type": "notification", "data": event["data"]})

    # ------------------------
    # Helpers
    # ------------------------
    @database_sync_to_async
    def get_user_from_token(self):
        qs = self.scope.get("query_string", b"").decode()
        token = parse_qs(qs).get("token", [None])[0]
        if not token:
            return None
        try:
            jwt_auth = JWTAuthentication()
            validated = jwt_auth.get_validated_token(token)
            return jwt_auth.get_user(validated)
        except Exception:
            return None

    @database_sync_to_async
    def get_recent_notifications(self):
        return list(
            PushNotification.objects.filter(user=self.user)
            .order_by("-created_at")
            .values("id", "title", "body", "url", "type", "created_at")[:10]
        )
