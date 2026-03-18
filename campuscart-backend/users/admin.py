# users/admin.py
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User
from django.forms import ModelForm


class UserCreationForm(ModelForm):
    class Meta:
        model = User
        fields = ("email", "name")


class UserChangeForm(ModelForm):
    class Meta:
        model = User
        fields = ("email", "name", "is_active", "is_staff", "is_superuser")


class UserAdmin(BaseUserAdmin):
    form = UserChangeForm
    add_form = UserCreationForm

    list_display = ("email", "name", "seller_rating", "total_reviews", "is_staff", "is_active")
    list_filter = ("is_staff", "is_superuser", "is_active")
    search_fields = ("email", "name")
    ordering = ("email",)

    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("name", "campus", "phone")}),
        ("Seller reputation", {"fields": ("seller_rating", "total_reviews")}),
        ("Permissions", {"fields": ("is_staff", "is_superuser", "is_active", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("date_joined",)}),
    )
    readonly_fields = ("seller_rating", "total_reviews")

    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "name", "password1", "password2"),
        }),
    )


admin.site.register(User, UserAdmin)
