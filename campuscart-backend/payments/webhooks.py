# payments/webhooks.py
import stripe
from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from orders.models import Order, Payment

stripe.api_key = settings.STRIPE_SECRET_KEY

@csrf_exempt
def stripe_webhook(request):
    payload = request.body
    sig_header = request.META.get('HTTP_STRIPE_SIGNATURE')
    endpoint_secret = settings.STRIPE_WEBHOOK_SECRET  # Add this in settings.py

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, endpoint_secret
        )
    except ValueError:
        # Invalid payload
        return HttpResponse(status=400)
    except stripe.error.SignatureVerificationError:
        # Invalid signature
        return HttpResponse(status=400)

    # ✅ Handle successful checkout
    if event['type'] == 'checkout.session.completed':
        session = event['data']['object']
        session_id = session.get('id')
        payment_intent = session.get('payment_intent')

        print("✅ Stripe session completed:", session_id)

        try:
            order = Order.objects.get(stripe_session_id=session_id)
        except Order.DoesNotExist:
            print("⚠️ No order found for session:", session_id)
            return HttpResponse(status=404)

        # Update order status and payment info
        order.status = Order.STATUS_PAID
        order.payment_status = Order.PAYMENT_SUCCESS
        order.paid = True
        order.payment_id = payment_intent
        order.amount_paid = order.total_price
        order.save(update_fields=[
            'status',
            'payment_status',
            'paid',
            'payment_id',
            'amount_paid',
            'updated_at'
        ])

        # Update or create Payment entry
        payment, _ = Payment.objects.get_or_create(order=order)
        payment.status = Order.PAYMENT_SUCCESS
        payment.provider_payment_id = payment_intent
        payment.save(update_fields=['status', 'provider_payment_id'])

        print(f"✅ Order #{order.id} marked as PAID.")

    return HttpResponse(status=200)
