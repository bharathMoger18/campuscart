# orders/models.py
from decimal import Decimal
from django.conf import settings
from django.db import models
from django.utils import timezone
from products.models import Product

class Order(models.Model):
    # Order status flow
    STATUS_PENDING = "PENDING"
    STATUS_PAID = "PAID"
    STATUS_SHIPPED = "SHIPPED"
    STATUS_DELIVERED = "DELIVERED"
    STATUS_COMPLETED = "COMPLETED"
    STATUS_CANCELLED = "CANCELLED"
    

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_PAID, "Paid"),
        (STATUS_SHIPPED, "Shipped"),
        (STATUS_DELIVERED, "Delivered"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    # Payment status
    PAYMENT_PENDING = "PENDING"
    PAYMENT_SUCCESS = "SUCCESS"
    PAYMENT_FAILED = "FAILED"
    PAYMENT_REFUNDED = "REFUNDED"

    PAYMENT_CHOICES = [
        (PAYMENT_PENDING, "Pending"),
        (PAYMENT_SUCCESS, "Success"),
        (PAYMENT_FAILED, "Failed"),
        (PAYMENT_REFUNDED, "Refunded"),
    ]

    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="orders")
    seller = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sales")
    total_price = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default=STATUS_PENDING)
    payment_status = models.CharField(max_length=30, choices=PAYMENT_CHOICES, default=PAYMENT_PENDING)
    payment_id = models.CharField(max_length=128, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    paid = models.BooleanField(default=False)
    stripe_session_id = models.CharField(max_length=255, blank=True, null=True)
    stripe_payment_intent = models.CharField(max_length=255, blank=True, null=True)
    amount_paid = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal('0.00')
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Order {self.id} from {self.buyer} → {self.seller} (${self.total_price})"

    # ✅ NEW: Enforce valid order state transitions
    VALID_TRANSITIONS = {
        STATUS_PENDING: [STATUS_PAID, STATUS_SHIPPED, STATUS_CANCELLED],
        STATUS_PAID: [STATUS_SHIPPED, STATUS_CANCELLED],
        STATUS_SHIPPED: [STATUS_DELIVERED, STATUS_COMPLETED],  # ✅ allow direct complete
        STATUS_DELIVERED: [STATUS_COMPLETED],
        STATUS_COMPLETED: [],
        STATUS_CANCELLED: [],
    }



    def can_transition_to(self, new_status: str) -> bool:
        """Return True if transition from current → new_status is valid."""
        allowed = self.VALID_TRANSITIONS.get(self.status, [])
        return new_status in allowed

    def set_status(self, new_status: str, actor=None, note: str | None = None):
        """
        Update order status safely, enforcing allowed transitions and recording history.
        actor: optional user who performed the transition (useful for audit).
        note: optional free text note.
        """
        new_status = (new_status or "").upper()
        if not self.can_transition_to(new_status):
            raise ValueError(f"Invalid status transition: {self.status} → {new_status}")

        previous = self.status
        self.status = new_status
        # persist change (updated_at auto)
        self.save(update_fields=["status", "updated_at"])
        # create history entry
        OrderStatusHistory.objects.create(
            order=self,
            from_status=previous,
            to_status=new_status,
            actor=actor,
            note=note,
            timestamp=timezone.now(),
        )

    def mark_refunded(self, actor=None, note=None):
        """Safely mark order as refunded and log it."""
        previous_status = self.status
        self.status = Order.STATUS_CANCELLED
        self.payment_status = Order.PAYMENT_REFUNDED
        self.save(update_fields=["status", "payment_status", "updated_at"])
        OrderStatusHistory.objects.create(
            order=self,
            from_status=previous_status,
            to_status=self.status,
            actor=actor,
            note=note or "Refund processed",
            timestamp=timezone.now(),
        )


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, blank=True)
    product_title = models.CharField(max_length=255)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    quantity = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.product_title} × {self.quantity}"

    @property
    def total_price(self):
        return self.price * self.quantity


class Payment(models.Model):
    METHOD_COD = "COD"
    METHOD_CARD = "CARD"
    METHOD_UPI = "UPI"
    METHOD_CHOICES = [
        (METHOD_COD, "COD"),
        (METHOD_CARD, "Card"),
        (METHOD_UPI, "UPI"),
    ]

    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="payment")
    method = models.CharField(max_length=20, choices=METHOD_CHOICES, default=METHOD_COD)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    provider_payment_id = models.CharField(max_length=255, blank=True, null=True)
    status = models.CharField(max_length=30, choices=Order.PAYMENT_CHOICES, default=Order.PAYMENT_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Payment({self.order_id} - {self.status})"


class OrderStatusHistory(models.Model):
    """
    Persisted timeline record for each status change.
    """
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="status_history")
    from_status = models.CharField(max_length=30, choices=Order.STATUS_CHOICES)
    to_status = models.CharField(max_length=30, choices=Order.STATUS_CHOICES)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    note = models.TextField(blank=True, null=True)
    timestamp = models.DateTimeField()

    class Meta:
        ordering = ["timestamp"]

    def __str__(self):
        return f"OrderStatusHistory(order={self.order_id} {self.from_status}→{self.to_status} at {self.timestamp})"



class RefundRequest(models.Model):
    """Represents a refund/dispute request from buyer."""
    STATUS_PENDING = "PENDING"
    STATUS_APPROVED = "APPROVED"
    STATUS_REJECTED = "REJECTED"

    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_APPROVED, "Approved"),
        (STATUS_REJECTED, "Rejected"),
    ]

    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="refund_request")
    buyer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="refund_requests")
    seller = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="refunds_received")
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    admin_note = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"RefundRequest(order={self.order_id}, status={self.status})"

    def approve(self, actor=None, note=None):
        self.status = RefundRequest.STATUS_APPROVED
        self.admin_note = note or ""
        self.resolved_at = timezone.now()
        self.save(update_fields=["status", "admin_note", "resolved_at"])
        self.order.mark_refunded(actor=actor, note="Refund approved")

    def reject(self, actor=None, note=None):
        self.status = RefundRequest.STATUS_REJECTED
        self.admin_note = note or ""
        self.resolved_at = timezone.now()
        self.save(update_fields=["status", "admin_note", "resolved_at"])