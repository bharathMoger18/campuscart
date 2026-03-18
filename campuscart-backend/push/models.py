# push/models.py
from django.conf import settings
from django.db import models


class PushSubscription(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="push_subscriptions",
    )
    endpoint = models.TextField()
    p256dh = models.CharField(max_length=255)
    auth = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"PushSub(user={self.user.email}, endpoint={self.endpoint[:60]})"


class PushNotification(models.Model):
    """
    Log of a notification that was attempted to be sent.
    - One record per logical notification (not per subscription).
    - If you prefer one record per subscription, we can easily change it.
    """
    NOTIF_TYPES = [
        ("general", "General"),
        ("chat_message", "Chat Message"),
        ("chat_read", "Chat Read"),
        ("wishlist_like", "Wishlist Like"),
        ("order", "Order"),
        ("product_new", "New Product"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    url = models.CharField(max_length=512, default="/")
    type = models.CharField(max_length=50, choices=NOTIF_TYPES, default="general")
    data = models.JSONField(blank=True, null=True)  # extra payload
    delivered = models.BooleanField(default=False)  # True if at least one subscription accepted it
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Notification({self.user}, {self.title[:30]})"
