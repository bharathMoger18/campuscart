# wishlist/views.py
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Wishlist, WishlistItem
from .serializers import WishlistSerializer
from products.models import Product
from push.utils import notify_seller_wishlist_like  # 🆕 cleaner import


class WishlistViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_wishlist(self, user):
        wishlist, _ = Wishlist.objects.get_or_create(user=user)
        return wishlist

    def list(self, request):
        """Get current user's wishlist"""
        wishlist = self.get_wishlist(request.user)
        serializer = WishlistSerializer(wishlist)
        return Response(serializer.data)

    @action(detail=False, methods=["post"])
    def add(self, request):
        """Add a product to wishlist (and notify the seller)."""
        product_id = request.data.get("product_id")
        product = Product.objects.filter(id=product_id, is_deleted=False).first()
        if not product:
            return Response({"error": "Invalid product"}, status=404)

        wishlist = self.get_wishlist(request.user)
        item, created = WishlistItem.objects.get_or_create(wishlist=wishlist, product=product)

        if created:
            message = "Product added to wishlist."
            # 🆕 Trigger push to seller
            notify_seller_wishlist_like(request.user, product)
        else:
            message = "Product already in wishlist."

        return Response({
            "message": message,
            "wishlist": WishlistSerializer(wishlist).data,
        })

    @action(detail=False, methods=["post"])
    def remove(self, request):
        """Remove product from wishlist"""
        product_id = request.data.get("product_id")
        wishlist = self.get_wishlist(request.user)
        WishlistItem.objects.filter(wishlist=wishlist, product_id=product_id).delete()
        return Response(WishlistSerializer(wishlist).data)

    @action(detail=False, methods=["post"])
    def clear(self, request):
        """Remove all items from wishlist"""
        wishlist = self.get_wishlist(request.user)
        wishlist.items.all().delete()
        return Response({"message": "Wishlist cleared successfully."})

    @action(detail=False, methods=["post"], url_path="move-to-cart")
    def move_to_cart(self, request):
        """Move an item from wishlist to cart."""
        from cart.models import Cart, CartItem  # avoid circular imports

        product_id = request.data.get("product_id")
        if not product_id:
            return Response({"error": "product_id is required"}, status=400)

        wishlist = self.get_wishlist(request.user)
        wishlist_item = wishlist.items.filter(product_id=product_id).first()
        if not wishlist_item:
            return Response({"error": "Product not found in wishlist"}, status=404)

        product = wishlist_item.product
        if product.is_deleted:
            return Response({"error": "Product no longer available"}, status=400)

        cart, _ = Cart.objects.get_or_create(user=request.user)
        item, created = CartItem.objects.get_or_create(cart=cart, product=product)
        if not created:
            item.quantity += 1
        item.save()

        wishlist_item.delete()

        from cart.serializers import CartSerializer
        return Response({
            "message": "Moved to cart successfully.",
            "cart": CartSerializer(cart).data,
            "wishlist": WishlistSerializer(wishlist).data,
        }, status=status.HTTP_200_OK)
