# orders/admin.py
from django.contrib import admin
from django.utils.html import format_html
from .models import Order, OrderItem, Payment, OrderStatusHistory,RefundRequest


class OrderItemInline(admin.TabularInline):
    """Inline view of all items in an order."""
    model = OrderItem
    extra = 0
    readonly_fields = ("product_title", "price", "quantity", "created_at")
    can_delete = False


class PaymentInline(admin.StackedInline):
    """Inline view of payment details linked to an order."""
    model = Payment
    extra = 0
    readonly_fields = ("method", "amount", "status", "created_at")
    can_delete = False

class OrderStatusHistoryInline(admin.TabularInline):
    """Inline view showing full order status change timeline."""
    model = OrderStatusHistory
    extra = 0
    readonly_fields = ("from_status", "to_status", "actor", "note", "timestamp")
    can_delete = False
    ordering = ("-timestamp",)

    def has_add_permission(self, request, obj=None):
        """History should be system-generated only."""
        return False


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "buyer",
        "seller",
        "colored_status",
        "colored_payment_status",
        "total_price",
        "created_at",
    )
    list_filter = ("status", "payment_status", "created_at")
    search_fields = ("buyer__email", "seller__email", "id")
    readonly_fields = ("created_at", "updated_at")
    inlines = [OrderItemInline, PaymentInline, OrderStatusHistoryInline]

    fieldsets = (
        (None, {
            "fields": (
                "buyer",
                "seller",
                "total_price",
                "status",
                "payment_status",
                "payment_id",
            )
        }),
        ("Timestamps", {
            "fields": ("created_at", "updated_at"),
        }),
    )

    def has_add_permission(self, request):
        """Prevent manual order creation in admin (must come from cart flow)."""
        return False

    # 🟢 Color-coded badges for readability
    def colored_status(self, obj):
        color_map = {
            "PENDING": "orange",
            "PAID": "blue",
            "SHIPPED": "#17a2b8",  # teal
            "DELIVERED": "#28a745",  # green
            "COMPLETED": "green",
            "CANCELLED": "red",
        }
        color = color_map.get(obj.status, "gray")
        return format_html(
            f'<span style="padding:3px 8px; border-radius:6px; background:{color}; color:white; font-weight:bold;">{obj.status}</span>'
        )

    colored_status.short_description = "Status"
    colored_status.admin_order_field = "status"

    def colored_payment_status(self, obj):
        color_map = {
            "PENDING": "orange",
            "SUCCESS": "green",
            "FAILED": "red",
            "REFUNDED": "gray",
        }
        color = color_map.get(obj.payment_status, "gray")
        return format_html(
            f'<span style="padding:3px 8px; border-radius:6px; background:{color}; color:white; font-weight:bold;">{obj.payment_status}</span>'
        )

    colored_payment_status.short_description = "Payment"
    colored_payment_status.admin_order_field = "payment_status"


@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "product_title", "price", "quantity", "created_at")
    readonly_fields = ("created_at",)
    search_fields = ("product_title", "order__id")
    list_filter = ("created_at",)


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "method", "status", "amount", "created_at")
    list_filter = ("method", "status", "created_at")
    readonly_fields = ("created_at",)
    search_fields = ("order__id", "provider_payment_id")

@admin.register(RefundRequest)
class RefundRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "order", "buyer", "seller", "status", "created_at", "resolved_at")
    list_filter = ("status", "created_at", "resolved_at")
    search_fields = ("order__id", "buyer__email", "seller__email")
    readonly_fields = ("created_at", "resolved_at")
