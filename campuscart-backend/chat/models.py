# chat/models.py
from django.conf import settings
from django.db import models
from django.utils import timezone

class Conversation(models.Model):
    """A conversation optionally tied to a product (context)."""
    product = models.ForeignKey(
        "products.Product", null=True, blank=True, on_delete=models.SET_NULL, related_name="conversations"
    )
    participants = models.ManyToManyField(settings.AUTH_USER_MODEL, related_name="conversations")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Conversation {self.id} (product={self.product_id})"


class Message(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sent_messages")
    text = models.TextField()
    timestamp = models.DateTimeField(default=timezone.now)
    read = models.BooleanField(default=False)

    class Meta:
        ordering = ("timestamp",)

    def __str__(self):
        return f"Msg {self.id} by {self.sender}"
