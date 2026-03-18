# chat/consumers.py
import json
from urllib.parse import parse_qs

from channels.generic.websocket import AsyncJsonWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model

from .models import Conversation, Message
from push.utils import notify_users_about_message, send_push_to_user

User = get_user_model()


class ChatConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        """Authenticate user and join conversation group."""
        self.conversation_id = self.scope["url_route"]["kwargs"]["conversation_id"]

        # Authenticate via JWT token
        self.user = await self.get_user_from_token()
        if not self.user:
            await self.close(code=4001)
            return

        # Verify user is part of this conversation
        is_participant = await self.is_participant()
        if not is_participant:
            await self.close(code=4003)
            return

        self.room_group_name = f"chat_{self.conversation_id}"
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        await self.send_json({"message": "Connected successfully."})

    async def disconnect(self, code):
        """Remove from group on disconnect."""
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    # -------------------------------------------------------------------------
    # RECEIVE
    # -------------------------------------------------------------------------
    async def receive_json(self, content, **kwargs):
        """
        Expected:
          → {"message": "Hi there"}                → send chat message
          → {"type": "read_receipt", "message_id": 7}  → mark as read
        """
        if "message" in content:
            await self.handle_new_message(content["message"])
        elif content.get("type") == "read_receipt":
            await self.handle_read_receipt(content.get("message_id"))

    # -------------------------------------------------------------------------
    # NEW MESSAGE
    # -------------------------------------------------------------------------
    async def handle_new_message(self, text: str):
        """Save message, broadcast via WebSocket, trigger push."""
        if not text:
            return

        msg_obj = await self.save_message(text)

        payload = {
            "id": msg_obj.id,
            "conversation_id": int(self.conversation_id),
            "sender_id": msg_obj.sender_id,
            "sender_name": getattr(msg_obj.sender, "name", getattr(msg_obj.sender, "email", str(msg_obj.sender))),
            "text": msg_obj.text,
            "timestamp": msg_obj.timestamp.isoformat(),
        }

        # Send to all WebSocket clients in conversation
        await self.channel_layer.group_send(
            self.room_group_name,
            {"type": "chat.message", "payload": payload},
        )

        # Send push notifications to other participants
        await database_sync_to_async(notify_users_about_message)(
            msg_obj.conversation,
            {
                "sender_id": payload["sender_id"],
                "sender_name": payload["sender_name"],
                "text": payload["text"],
                "conversation_id": payload["conversation_id"],
            },
        )

    # -------------------------------------------------------------------------
    # READ RECEIPT
    # -------------------------------------------------------------------------
    async def handle_read_receipt(self, message_id: int):
        """Mark message as read, broadcast receipt, push to sender."""
        if not message_id:
            return

        msg_obj = await self.get_message_by_id(message_id)
        if not msg_obj:
            return

        # Skip if same user (sender cannot mark their own)
        if msg_obj.sender_id == self.user.id:
            return

        # Mark as read
        await self.mark_message_as_read(msg_obj)

        payload = {
            "message_id": msg_obj.id,
            "reader_id": self.user.id,
            "reader_name": getattr(self.user, "name", self.user.email),
        }

        # Notify all connected users (so sender sees blue ticks)
        await self.channel_layer.group_send(
            self.room_group_name,
            {"type": "chat.read_receipt", "payload": payload},
        )

        # Send push notification to sender if not self
        await database_sync_to_async(self.send_read_push)(msg_obj, payload)

    # -------------------------------------------------------------------------
    # EVENT HANDLERS
    # -------------------------------------------------------------------------
    async def chat_message(self, event):
        """Send message to WebSocket."""
        await self.send_json(event.get("payload", event))

    async def chat_read_receipt(self, event):
        """Send read receipt to WebSocket."""
        await self.send_json(event.get("payload", event))

    # -------------------------------------------------------------------------
    # DATABASE HELPERS
    # -------------------------------------------------------------------------
    @database_sync_to_async
    def save_message(self, text):
        conversation = Conversation.objects.get(id=self.conversation_id)
        return Message.objects.create(conversation=conversation, sender=self.user, text=text)

    @database_sync_to_async
    def get_message_by_id(self, message_id):
        return Message.objects.filter(id=message_id, conversation_id=self.conversation_id).first()

    @database_sync_to_async
    def mark_message_as_read(self, msg_obj):
        msg_obj.read = True
        msg_obj.save(update_fields=["read"])
        return msg_obj

    def send_read_push(self, msg_obj, payload):
        """Send push notification to sender that their message was read."""
        send_push_to_user(
            msg_obj.sender,
            "💬 Message Read",
            f"{payload['reader_name']} read your message.",
            url=f"/chat/{msg_obj.conversation_id}/",
            type_="chat_read",
        )

    # -------------------------------------------------------------------------
    # AUTH HELPERS
    # -------------------------------------------------------------------------
    @database_sync_to_async
    def is_participant(self):
        return Conversation.objects.filter(id=self.conversation_id, participants=self.user).exists()

    @database_sync_to_async
    def get_user_from_token(self):
        """Extract token from query string, validate via SimpleJWT."""
        from rest_framework_simplejwt.authentication import JWTAuthentication
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
