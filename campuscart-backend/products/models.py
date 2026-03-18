# products/models.py
from django.db import models
from django.conf import settings

class Product(models.Model):
    CATEGORY_CHOICES = [
        ("Books", "Books"),
        ("Electronics", "Electronics"),
        ("Clothing", "Clothing"),
        ("Accessories", "Accessories"),
        ("Other", "Other"),
    ]

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="products"
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    category = models.CharField(max_length=50, choices=CATEGORY_CHOICES, default="Other")
    price = models.DecimalField(max_digits=10, decimal_places=2)
    image = models.ImageField(upload_to="product_images/", blank=True, null=True)
    is_available = models.BooleanField(default=True)
    is_deleted = models.BooleanField(default=False)  # 🆕 new field
    deleted_at = models.DateTimeField(null=True, blank=True)  # optional log
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title

    def delete(self, *args, **kwargs):
        """Soft delete: mark unavailable instead of removing."""
        from django.utils import timezone
        self.is_available = False
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save()

    @property
    def average_rating(self):
        reviews = self.reviews.all()
        if not reviews.exists():
            return 0
        return round(sum(r.rating for r in reviews) / reviews.count(), 1)

    @property
    def total_reviews(self):
        return self.reviews.count()
    
    def rating_breakdown(self):
        """Return a dictionary of {rating: count} for 1–5 stars."""
        from collections import Counter
        ratings = list(self.reviews.values_list("rating", flat=True))
        counts = Counter(ratings)
        breakdown = {str(i): counts.get(i, 0) for i in range(5, 0, -1)}
        return breakdown



