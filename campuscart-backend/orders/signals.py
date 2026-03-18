# orders/signals.py
from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Order
from push.utils import send_push_to_user

@receiver(post_save, sender=Order)
def order_post_save(sender, instance, created, **kwargs):
    if created:
        # notify seller that a new order was created
        title = "🛍 New Order Received"
        body = f"{instance.buyer.name or instance.buyer.email} placed an order."
        try:
            send_push_to_user(instance.seller, title, body, url=f"/orders/{instance.id}/", type_="order")
        except Exception:
            # we don't want to raise here
            pass
