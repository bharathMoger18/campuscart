# campuscart/api_urls.py
from django.urls import include, path
from payments import webhooks

urlpatterns = [
    path("", include("users.urls")),
    path("", include("products.urls")),
    path("", include("cart.urls")),
    path("", include("wishlist.urls")),
    path("", include("reviews.urls")),  # 🆕 add this line
    path("", include("chat.urls")),
    path("", include("push.urls")),
    path("", include("orders.urls")),
    # path("", include("payments.urls")),
    path("webhook/", webhooks.stripe_webhook, name="stripe_webhook_direct"),
]



