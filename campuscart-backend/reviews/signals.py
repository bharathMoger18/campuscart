# reviews/signals.py
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.db.models import Avg, Count
from .models import Review
from products.models import Product
from users.models import User


def update_seller_rating_for_product(product: Product):
    """Recalculate and update seller rating for a product's owner."""
    seller = product.owner

    # Aggregate across ALL reviews for all of seller’s products
    all_reviews = Review.objects.filter(product__owner=seller)
    agg = all_reviews.aggregate(avg_rating=Avg("rating"), total=Count("id"))
    avg = agg["avg_rating"] or 0
    total = agg["total"] or 0

    # Update seller profile
    seller.seller_rating = round(avg, 2)
    seller.total_reviews = total
    seller.save(update_fields=["seller_rating", "total_reviews"])


@receiver(post_save, sender=Review)
def update_seller_rating_on_save(sender, instance, **kwargs):
    update_seller_rating_for_product(instance.product)


@receiver(post_delete, sender=Review)
def update_seller_rating_on_delete(sender, instance, **kwargs):
    update_seller_rating_for_product(instance.product)
