# products/admin.py
from django.contrib import admin
from .models import Product
from django.utils.html import format_html

@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "category",
        "price",
        "average_rating_display",
        "total_reviews_display",
        "is_available",
        "is_deleted",
        "owner",
        "created_at",
        "image_preview",
    )
    list_filter = ("category", "is_available", "is_deleted", "created_at")
    search_fields = ("title", "description", "category", "owner__email")
    list_editable = ("is_available",)
    ordering = ("-created_at",)
    date_hierarchy = "created_at"
    readonly_fields = ("created_at", "updated_at", "deleted_at")

    fieldsets = (
        (None, {
            "fields": ("title", "description", "category", "price", "owner", "image", "is_available")
        }),
        ("Soft Delete Info", {
            "classes": ("collapse",),
            "fields": ("is_deleted", "deleted_at"),
        }),
        ("Timestamps", {
            "classes": ("collapse",),
            "fields": ("created_at", "updated_at"),
        }),
    )

    def image_preview(self, obj):
        """Show a small image preview in admin list."""
        if obj.image:
            return format_html('<img src="{}" width="60" style="border-radius:4px;" />', obj.image.url)
        return "-"
    image_preview.short_description = "Image"

    def save_model(self, request, obj, form, change):
        """Ensure owner is set if created via admin."""
        if not obj.owner_id:
            obj.owner = request.user
        super().save_model(request, obj, form, change)

    def average_rating_display(self, obj):
      return obj.average_rating
    average_rating_display.short_description = "Avg Rating"

    def total_reviews_display(self, obj):
        return obj.total_reviews
    total_reviews_display.short_description = "Reviews"
