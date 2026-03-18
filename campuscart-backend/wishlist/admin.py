# wishlist/admin.py
from django.contrib import admin
from .models import Wishlist, WishlistItem

class WishlistItemInline(admin.TabularInline):
    model = WishlistItem
    extra = 0
    readonly_fields = ("product", "added_at")

@admin.register(Wishlist)
class WishlistAdmin(admin.ModelAdmin):
    list_display = ("user_email", "total_items", "created_at", "updated_at")
    inlines = [WishlistItemInline]
    search_fields = ("user__email",)
    ordering = ("-updated_at",)

    def user_email(self, obj):
        return obj.user.email

    def total_items(self, obj):
        return obj.items.count()
    total_items.short_description = "Items"

@admin.register(WishlistItem)
class WishlistItemAdmin(admin.ModelAdmin):
    list_display = ("wishlist_user", "product", "added_at")
    search_fields = ("wishlist__user__email", "product__title")
    ordering = ("-added_at",)

    def wishlist_user(self, obj):
        return obj.wishlist.user.email
    wishlist_user.short_description = "User"
