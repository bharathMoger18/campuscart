# payments/urls.py
from django.urls import path
from . import views, webhooks

urlpatterns = [
    path("create-checkout-session/", views.create_checkout_session, name="create_checkout_session"),
    path("webhook/", webhooks.stripe_webhook, name="stripe_webhook"),  # ✅ changed from stripe/webhook/ to webhook/
]