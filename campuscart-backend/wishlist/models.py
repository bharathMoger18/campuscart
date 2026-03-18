# wishlist/models.py
from django.db import models
from django.conf import settings
from products.models import Product

class Wishlist(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="wishlist"
    )
    products = models.ManyToManyField(
        Product,
        related_name="wishlisted_by",
        through="WishlistItem"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email}'s Wishlist"


class WishlistItem(models.Model):
    wishlist = models.ForeignKey(Wishlist, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("wishlist", "product")

    def __str__(self):
        return f"{self.product.title}"
