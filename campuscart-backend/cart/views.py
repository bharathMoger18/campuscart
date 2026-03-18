# cart/views.py
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Cart, CartItem
from .serializers import CartSerializer, CartItemSerializer
from products.models import Product

class CartViewSet(viewsets.ViewSet):
    permission_classes = [permissions.IsAuthenticated]

    def get_cart(self, user):
        cart, _ = Cart.objects.get_or_create(user=user)
        return cart

    def list(self, request):
        """Return current user's cart."""
        cart = self.get_cart(request.user)
        serializer = CartSerializer(cart)
        return Response(serializer.data)

    @action(detail=False, methods=["post"])
    def add(self, request):
        """Add or update a product in the cart."""
        product_id = request.data.get("product_id")
        quantity = int(request.data.get("quantity", 1))
        if not product_id:
            return Response({"error": "product_id required"}, status=400)

        cart = self.get_cart(request.user)
        product = Product.objects.filter(id=product_id, is_deleted=False).first()
        if not product:
            return Response({"error": "Invalid product"}, status=404)

        item, created = CartItem.objects.get_or_create(cart=cart, product=product)
        if not created:
            item.quantity += quantity
        else:
            item.quantity = quantity
        item.save()

        return Response(CartSerializer(cart).data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=["post"])
    def remove(self, request):
        """Remove a product from the cart."""
        product_id = request.data.get("product_id")
        cart = self.get_cart(request.user)
        CartItem.objects.filter(cart=cart, product_id=product_id).delete()
        return Response(CartSerializer(cart).data)

    @action(detail=False, methods=["post"])
    def clear(self, request):
        """Empty the cart."""
        cart = self.get_cart(request.user)
        cart.items.all().delete()
        return Response({"message": "Cart cleared successfully."})
