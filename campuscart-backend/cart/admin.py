# cart/admin.py
from django.contrib import admin
from .models import Cart, CartItem
from django.utils.html import format_html

class CartItemInline(admin.TabularInline):
    model = CartItem
    extra = 0
    readonly_fields = ("product", "quantity", "total_price")
    fields = ("product", "quantity", "total_price")

    def total_price(self, obj):
        return f"₹{obj.total_price}"
    total_price.short_description = "Total Price"


@admin.register(Cart)
class CartAdmin(admin.ModelAdmin):
    list_display = ("user_email", "total_items_display", "total_price_display", "updated_at")
    readonly_fields = ("total_items", "total_price", "created_at", "updated_at")
    search_fields = ("user__email",)
    ordering = ("-updated_at",)
    inlines = [CartItemInline]

    def user_email(self, obj):
        return obj.user.email
    user_email.short_description = "User"

    def total_items_display(self, obj):
        return obj.total_items
    total_items_display.short_description = "Items"

    def total_price_display(self, obj):
        return f"₹{obj.total_price:,.2f}"
    total_price_display.short_description = "Total Value"

    fieldsets = (
        (None, {"fields": ("user",)}),
        ("Cart Summary", {"fields": ("total_items", "total_price")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(CartItem)
class CartItemAdmin(admin.ModelAdmin):
    list_display = ("cart_user", "product_title", "quantity", "total_price_display", "added_at")
    search_fields = ("cart__user__email", "product__title")
    list_filter = ("added_at",)
    ordering = ("-added_at",)

    def cart_user(self, obj):
        return obj.cart.user.email
    cart_user.short_description = "User"

    def product_title(self, obj):
        return obj.product.title
    product_title.short_description = "Product"

    def total_price_display(self, obj):
        return f"₹{obj.total_price:,.2f}"
    total_price_display.short_description = "Total Price"
