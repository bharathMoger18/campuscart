# wishlist/urls.py
from django.urls import path
from .views import WishlistViewSet

wishlist_list = WishlistViewSet.as_view({"get": "list"})
wishlist_add = WishlistViewSet.as_view({"post": "add"})
wishlist_remove = WishlistViewSet.as_view({"post": "remove"})
wishlist_clear = WishlistViewSet.as_view({"post": "clear"})
wishlist_move_to_cart = WishlistViewSet.as_view({"post": "move_to_cart"})

urlpatterns = [
    path("wishlist/", wishlist_list, name="wishlist-detail"),
    path("wishlist/add/", wishlist_add, name="wishlist-add"),
    path("wishlist/remove/", wishlist_remove, name="wishlist-remove"),
    path("wishlist/clear/", wishlist_clear, name="wishlist-clear"),
    path("wishlist/move-to-cart/", wishlist_move_to_cart, name="wishlist-move-to-cart"),
]
