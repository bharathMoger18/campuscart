# reviews/views.py
from rest_framework import viewsets, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from .models import Review
from .serializers import ReviewSerializer
from products.models import Product
from orders.models import OrderItem, Order


class IsOwnerOrReadOnly(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.user == request.user


class ReviewViewSet(viewsets.ModelViewSet):
    queryset = Review.objects.select_related("user", "product").all()
    serializer_class = ReviewSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]

    def perform_create(self, serializer):
        """
        Save review only if the user purchased and completed the order.
        """
        product = serializer.validated_data.get("product")
        user = self.request.user

        # Verify eligibility here as an extra safeguard (redundant but safe)
        has_completed_order = OrderItem.objects.filter(
            order__buyer=user,
            product=product,
            order__status=Order.STATUS_COMPLETED
        ).exists()

        if not has_completed_order:
            raise ValueError("You can only review products from completed orders.")

        serializer.save(user=user)

    def get_queryset(self):
        """Optionally filter by product_id"""
        product_id = self.request.query_params.get("product")
        if product_id:
            return self.queryset.filter(product_id=product_id)
        return self.queryset
