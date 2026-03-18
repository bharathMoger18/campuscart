from rest_framework import serializers
from .models import Product
from reviews.serializers import ReviewSerializer

class ProductSerializer(serializers.ModelSerializer):
    owner_email = serializers.EmailField(source="owner.email", read_only=True)
    owner_id = serializers.IntegerField(source="owner.id", read_only=True)  # ✅ Add this line
    average_rating = serializers.FloatField(read_only=True)
    total_reviews = serializers.IntegerField(read_only=True)
    rating_breakdown = serializers.SerializerMethodField()
    reviews = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id",
            "owner_id",
            "owner_email",
            "title",
            "description",
            "category",
            "price",
            "image",
            "is_available",
            "average_rating",
            "total_reviews",
            "rating_breakdown",
            "reviews",
            "created_at",
            "updated_at",
        ]

    def get_rating_breakdown(self, obj):
        return obj.rating_breakdown()

    def get_reviews(self, obj):
        reviews = obj.reviews.select_related("user").all()
        return ReviewSerializer(reviews, many=True).data
