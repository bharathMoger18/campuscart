# payments/views.py
import os
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.conf import settings
import stripe
from orders.models import Order

stripe.api_key = settings.STRIPE_SECRET_KEY


@csrf_exempt
def create_checkout_session(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST required"}, status=400)

    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
        order_id = data.get("order_id")
        amount = data.get("amount")
        product_name = data.get("product_name", "CampusCart Order")

        if not order_id or not amount:
            return JsonResponse({"error": "order_id and amount are required"}, status=400)

        try:
            order = Order.objects.get(id=order_id)
        except Order.DoesNotExist:
            return JsonResponse({"error": "Order not found"}, status=404)

        YOUR_DOMAIN = os.getenv("FRONTEND_URL","http://localhost")  # frontend URL

        checkout_session = stripe.checkout.Session.create(
            payment_method_types=["card"],
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "unit_amount": int(amount),  # cents
                    "product_data": {"name": product_name},
                },
                "quantity": 1,
            }],
            mode="payment",
            success_url=f"{YOUR_DOMAIN}/orders/order_detail.html?id={order_id}&payment=success",
            cancel_url=f"{YOUR_DOMAIN}/orders/checkout.html?cancel=true",
            customer_email=getattr(order.buyer, "email", None),
            client_reference_id=str(order_id),
            metadata={"order_id": str(order_id)},
        )

        # Save session ID for reference
        order.stripe_session_id = checkout_session.id
        order.save(update_fields=["stripe_session_id"])

        return JsonResponse({
            "session_id": checkout_session.id,
            "url": checkout_session.url,
        })

    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
