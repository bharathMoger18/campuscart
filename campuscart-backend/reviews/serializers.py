# reviews/serializers.py
from rest_framework import serializers
from .models import Review
from users.serializers import UserSerializer
from products.models import Product
from orders.models import OrderItem, Order


class ReviewSerializer(serializers.ModelSerializer):
    user_email = serializers.EmailField(source="user.email", read_only=True)
    product_title = serializers.CharField(source="product.title", read_only=True)

    class Meta:
        model = Review
        fields = [
            "id",
            "product",
            "product_title",
            "user",
            "user_email",
            "rating",
            "comment",
            "created_at",
            "updated_at"
        ]
        read_only_fields = ["user", "created_at", "updated_at"]

    def validate_rating(self, value):
        if value < 1 or value > 5:
            raise serializers.ValidationError("Rating must be between 1 and 5.")
        return value

    def validate_product(self, product):
        """
        Ensure the user can only review products they purchased in COMPLETED orders.
        """
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError("Authentication required to review products.")

        # Check if user purchased this product in a completed order
        purchased = OrderItem.objects.filter(
            order__buyer=user,
            product=product,
            order__status=Order.STATUS_COMPLETED
        ).exists()

        if not purchased:
            raise serializers.ValidationError("You can only review products from completed orders.")
        return product

    def create(self, validated_data):
        """
        Either create or update the user's review for the product.
        """
        user = self.context["request"].user
        product = validated_data["product"]
        review, created = Review.objects.update_or_create(
            user=user,
            product=product,
            defaults={
                "rating": validated_data["rating"],
                "comment": validated_data.get("comment", "")
            }
        )
        return review
