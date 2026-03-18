# reviews/admin.py
from django.contrib import admin
from .models import Review

@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ("product", "user_email", "rating", "short_comment", "created_at")
    search_fields = ("product__title", "user__email", "comment")
    list_filter = ("rating", "created_at")
    ordering = ("-created_at",)

    def user_email(self, obj):
        return obj.user.email
    user_email.short_description = "User"

    def short_comment(self, obj):
        return (obj.comment[:40] + "...") if len(obj.comment) > 40 else obj.comment
