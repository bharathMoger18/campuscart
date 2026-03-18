# cart/urls.py
from django.urls import path
from .views import CartViewSet

cart_list = CartViewSet.as_view({"get": "list"})
cart_add = CartViewSet.as_view({"post": "add"})
cart_remove = CartViewSet.as_view({"post": "remove"})
cart_clear = CartViewSet.as_view({"post": "clear"})

urlpatterns = [
    path("cart/", cart_list, name="cart-detail"),
    path("cart/add/", cart_add, name="cart-add"),
    path("cart/remove/", cart_remove, name="cart-remove"),
    path("cart/clear/", cart_clear, name="cart-clear"),
]
