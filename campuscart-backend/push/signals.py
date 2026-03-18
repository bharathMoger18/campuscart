# push/signals.py
import json
from django.db.models.signals import post_save
from django.dispatch import receiver
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from .models import PushNotification

@receiver(post_save, sender=PushNotification)
def broadcast_new_notification(sender, instance, created, **kwargs):
    """Broadcast new notifications to the user via WebSocket."""
    if not created:
        return

    channel_layer = get_channel_layer()
    group_name = f"user_notifications_{instance.user.id}"

    data = {
        "id": instance.id,
        "title": instance.title,
        "body": instance.body,
        "url": instance.url,
        "type": instance.type,
        "created_at": instance.created_at.isoformat(),
    }

    async_to_sync(channel_layer.group_send)(
        group_name,
        {
            "type": "notification_event",  # handled by NotificationsConsumer
            "data": data,
        },
    )
