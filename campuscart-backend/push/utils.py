# push/utils.py
import json
import logging
from django.conf import settings
from pywebpush import webpush, WebPushException
from .models import PushSubscription, PushNotification

logger = logging.getLogger(__name__)


def send_push(subscription_info: dict, payload: dict):
    """Low-level push to a single subscription."""
    try:
        webpush(
            subscription_info=subscription_info,
            data=json.dumps(payload),
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": settings.VAPID_EMAIL},
            timeout=10,
        )
        return True
    except WebPushException as exc:
        logger.warning("WebPush failed for %s: %s", subscription_info.get("endpoint"), repr(exc))
        raise


def send_push_to_user(user, title, body, url: str = "/", type_: str = "general", data: dict | None = None):
    """
    Send a Web Push to all user's subscriptions and log it in PushNotification.
    Returns (sent_count, notification)
    """
    subs = PushSubscription.objects.filter(user=user)
    payload = {
        "title": title,
        "body": body,
        "url": url,
        "type": type_,
        "icon": getattr(settings, "VAPID_NOTIFICATION_ICON", "/static/icon.png"),
    }
    if data:
        payload["data"] = data

    notif = PushNotification.objects.create(
        user=user,
        title=title,
        body=body,
        url=url,
        type=type_,
        data=data or {},
    )

    sent_count = 0
    for sub in subs:
        info = {"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}
        try:
            send_push(info, payload)
            sent_count += 1
        except WebPushException:
            try:
                sub.delete()
            except Exception:
                logger.exception("Failed deleting invalid subscription for user %s", user)

    notif.delivered = sent_count > 0
    notif.save(update_fields=["delivered"])
    return sent_count, notif


def notify_users_about_message(conversation, payload):
    """
    Send push to all participants except sender (Chat message push).
    """
    sender_id = payload.get("sender_id")
    recipients = conversation.participants.exclude(id=sender_id)
    for recipient in recipients:
        title = f"New message from {payload.get('sender_name')}"
        body = payload.get("text", "")[:120]
        url = f"/chat/{conversation.id}/"
        data = {"conversation_id": conversation.id, "sender_id": sender_id}

        send_push_to_user(recipient, title, body, url, "chat_message", data)


# 🆕 NEW: Wishlist → Seller push helper
def notify_seller_wishlist_like(buyer, product):
    """
    Notify a product owner when someone adds their product to a wishlist.
    Logs and sends the push.
    """
    if product.owner == buyer:
        return 0  # skip self-notification

    title = "❤️ Your product was wishlisted!"
    body = f"{buyer.name or buyer.email} added '{product.title}' to their wishlist."
    url = f"/products/{product.id}/"
    data = {"product_id": product.id, "buyer_id": buyer.id}

    sent, notif = send_push_to_user(
        product.owner,
        title,
        body,
        url=url,
        type_="wishlist_like",
        data=data,
    )

    logger.info("Wishlist push sent to %s (%d subs)", product.owner.email, sent)
    return sent


# push/utils.py (append at end)

def notify_refund_status(order, refund, initiated=False):
    """
    Notify buyer and seller about refund lifecycle events.
    - initiated=True → buyer created refund request
    - initiated=False → seller/admin made a decision
    """
    try:
        if initiated:
            # Buyer requested refund
            title = "💰 Refund Requested"
            body = (
                f"{refund.buyer.name or refund.buyer.email} requested a refund for Order #{order.id}."
                f" Reason: {refund.reason or 'No reason provided.'}"
            )
            send_push_to_user(
                refund.seller,
                title,
                body,
                url=f"/orders/{order.id}/",
                type_="refund_request",
                data={
                    "order_id": order.id,
                    "refund_id": getattr(refund, 'id', None),
                    "status": refund.status,
                    "reason": refund.reason,
                    "created_at": getattr(refund, 'created_at', None).isoformat() if getattr(refund, 'created_at', None) else None,
                },
            )

        else:
            # Seller/admin decision
            title = "✅ Refund Approved" if refund.status == "APPROVED" else "❌ Refund Rejected"
            body = (
                f"Your refund request for Order #{order.id} was {refund.status.lower()}."
                + (f" Note: {refund.admin_note}" if getattr(refund, 'admin_note', None) else "")
            )

            send_push_to_user(
                refund.buyer,
                title,
                body,
                url=f"/orders/{order.id}/",
                type_="refund_update",
                data={
                    "order_id": order.id,
                    "refund_id": getattr(refund, 'id', None),
                    "status": refund.status,
                    "reason": refund.reason,
                    "resolved_at": getattr(refund, 'resolved_at', None).isoformat() if getattr(refund, 'resolved_at', None) else None,
                    "admin_note": getattr(refund, 'admin_note', None),
                },
            )

        return True

    except Exception as exc:
        logger.exception("Failed to send refund notification for order_id=%s: %s", order.id, exc)
        return False
