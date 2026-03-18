# products/views.py
from rest_framework import viewsets, permissions, filters
from django_filters.rest_framework import DjangoFilterBackend
from django.shortcuts import render, redirect, get_object_or_404
from django.http import HttpResponseNotFound
from .models import Product
from .serializers import ProductSerializer
from .filters import ProductFilter


class IsOwnerOrReadOnly(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.owner == request.user


class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.filter(is_deleted=False).order_by("-created_at")
    serializer_class = ProductSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsOwnerOrReadOnly]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductFilter
    search_fields = ["title", "description", "category"]
    ordering_fields = ["price", "created_at"]

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    def perform_destroy(self, instance):
        """Override delete to do soft delete."""
        instance.delete()

    def get_serializer_class(self):
        if self.action == "retrieve":  # only include reviews on single-product view
            return ProductSerializer
        return ProductSerializer


# ---------------------------------------------------------------------
# 🆕 Lightweight HTML product detail (for /products/<id>/)
# ---------------------------------------------------------------------
def product_redirect_view(request, pk: int):
    """
    Minimal public endpoint to show product details or safe fallback.
    Used for push notification deep links (e.g., /products/5/).
    """
    try:
        product = Product.objects.get(id=pk)
    except Product.DoesNotExist:
        # Product not found → show safe fallback
        return render(request, "product_not_found.html", {"product_id": pk}, status=404)

    # Soft-deleted product? redirect to notifications
    if product.is_deleted or not product.is_available:
        return redirect("/notifications/")

    # Otherwise, render minimal product preview
    return render(request, "product_detail.html", {"product": product})


from rest_framework.decorators import action
from rest_framework.response import Response

class SellerProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwnerOrReadOnly]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = ProductFilter
    search_fields = ["title", "description", "category"]
    ordering_fields = ["price", "created_at"]

    def get_queryset(self):
        """Only return products owned by the logged-in seller"""
        return Product.objects.filter(owner=self.request.user, is_deleted=False).order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)
