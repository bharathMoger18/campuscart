# wishlist/serializers.py
from rest_framework import serializers
from .models import Wishlist, WishlistItem
from products.serializers import ProductSerializer

class WishlistItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)

    class Meta:
        model = WishlistItem
        fields = ["id", "product", "added_at"]
        read_only_fields = ["id", "product", "added_at"]

class WishlistSerializer(serializers.ModelSerializer):
    items = WishlistItemSerializer(many=True, read_only=True)

    class Meta:
        model = Wishlist
        fields = ["id", "user", "items", "created_at", "updated_at"]
        read_only_fields = ["user", "items", "created_at", "updated_at"]
