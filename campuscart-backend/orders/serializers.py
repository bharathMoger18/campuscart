# orders/serializers.py
from rest_framework import serializers
from .models import Order, OrderItem, Payment, OrderStatusHistory
from users.serializers import UserSerializer
from products.serializers import ProductSerializer

# Try to import RefundRequest model if present (project already had that)
try:
    from .models import RefundRequest  # optional
except Exception:
    RefundRequest = None


class OrderItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "product", "product_title", "price", "quantity", "total_price", "created_at"]
        read_only_fields = fields


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "method", "amount", "provider_payment_id", "status", "created_at"]
        read_only_fields = ["id", "created_at"]


class OrderStatusHistorySerializer(serializers.ModelSerializer):
    actor = UserSerializer(read_only=True)

    class Meta:
        model = OrderStatusHistory
        fields = ["id", "from_status", "to_status", "actor", "note", "timestamp"]
        read_only_fields = fields



class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    buyer = UserSerializer(read_only=True)
    seller = UserSerializer(read_only=True)
    payment = PaymentSerializer(read_only=True)
    payment_method = serializers.SerializerMethodField()  # ✅ Field defined

    class Meta:
        model = Order
        fields = [
            "id", "buyer", "seller", "total_price", "status",
            "payment_status", "payment_id", "payment", "payment_method",
            "items", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "buyer", "seller", "items", "payment", "created_at", "updated_at",
        ]

    # ✅ Move this method OUTSIDE Meta
    def get_payment_method(self, obj):
        """
        Return payment method intelligently:
        - If a Payment object exists -> use its 'method'
        - Else if payment_status == 'SUCCESS' -> treat as ONLINE
        - Else -> COD
        """
        # Case 1: Payment object exists (Stripe or manual entry)
        if hasattr(obj, "payment") and obj.payment:
            return obj.payment.method or "Unknown"

        # Case 2: Payment ID or status indicates online payment
        if obj.payment_status and obj.payment_status.upper() == "SUCCESS":
            if obj.payment_id and not obj.payment_id.startswith("AUTO-"):
                return "ONLINE"
            return "CARD"

        # Default case
        return "COD"

class OrderTrackingSerializer(serializers.Serializer):
    """
    Lightweight tracking payload for frontend timeline.
    Not a ModelSerializer because this aggregates multiple sources.
    """
    order_id = serializers.IntegerField()
    current_status = serializers.CharField()
    timeline = OrderStatusHistorySerializer(many=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


# Optional serializer for RefundRequest if model exists
if RefundRequest is not None:
    class RefundRequestSerializer(serializers.ModelSerializer):
        buyer = UserSerializer(read_only=True)
        seller = UserSerializer(read_only=True)
        order_id = serializers.IntegerField(source="order.id", read_only=True)

        class Meta:
            model = RefundRequest
            fields = [
                "id",
                "order_id",
                "buyer",
                "seller",
                "reason",
                "status",
                "admin_note",
                "created_at",
                "resolved_at",
            ]
            read_only_fields = ["id", "buyer", "seller", "created_at", "resolved_at", "order_id"]
