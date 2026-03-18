# orders/utils.py
import logging
from django.utils import timezone

logger = logging.getLogger(__name__)


def process_refund(payment, order=None, reason: str | None = None, simulate=True):
    """
    Attempt to reverse/refund a payment.

    - If `simulate` True or payment.provider_payment_id starts with 'SIM-', it will mark the
      payment.status and order.payment_status as REFUNDED (non-destructive).
    - If you want a real gateway, implement the gateway call here (use settings and provider SDK).
    - Returns (success: bool, message: str).
    """
    # Defensive: payment may be None
    if payment is None:
        return False, "No payment record to refund."

    try:
        provider_id = (payment.provider_payment_id or "").upper()
    except Exception:
        provider_id = ""

    # Quick simulation path for test payments or when simulate==True
    if simulate or provider_id.startswith("SIM-"):
        try:
            # Mark the payment refunded
            payment.status = order.PAYMENT_REFUNDED if hasattr(order, "PAYMENT_REFUNDED") else "REFUNDED"
            payment.save(update_fields=["status"])

            # Keep order.payment_status in sync
            if order:
                order.payment_status = order.PAYMENT_REFUNDED if hasattr(order, "PAYMENT_REFUNDED") else "REFUNDED"
                order.save(update_fields=["payment_status"])

            # Log a short history note (we avoid forcing invalid order state transitions)
            try:
                # Use OrderStatusHistory if available (create a neutral history entry)
                from .models import OrderStatusHistory  # local import
                OrderStatusHistory.objects.create(
                    order=order,
                    from_status=order.status,
                    to_status=order.status,
                    actor=None,
                    note=f"Payment refunded ({reason or 'no reason provided'})",
                    timestamp=timezone.now(),
                )
            except Exception:
                # not critical — just log
                logger.debug("Couldn't create OrderStatusHistory for refund (maybe not available).")

            return True, "Refund processed (simulated)."
        except Exception as exc:
            logger.exception("Simulated refund failed: %s", exc)
            return False, f"Simulated refund failed: {exc}"

    # ----
    # Placeholder for real gateway integration (you must implement)
    # Example plan:
    #  - Check payment.method and provider_payment_id
    #  - Call provider SDK / API to issue refund
    #  - If success: update payment.status / order.payment_status etc.
    #  - If failure: return False, message
    # ----
    try:
        raise NotImplementedError("Real payment gateway integration not configured.")
    except Exception as exc:
        logger.exception("Refund gateway not implemented: %s", exc)
        return False, str(exc)
  