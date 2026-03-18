# orders/views.py
from collections import defaultdict
from decimal import Decimal
from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import models
from .utils import process_refund

import logging

logger = logging.getLogger(__name__)

from .models import Order, OrderItem, Payment, OrderStatusHistory,RefundRequest
from .serializers import OrderSerializer, OrderTrackingSerializer,RefundRequestSerializer
from cart.models import Cart, CartItem
from products.models import Product
from push.utils import send_push_to_user,notify_refund_status

# Import reviews pieces for the new endpoint
from reviews.serializers import ReviewSerializer
from reviews.models import Review


class IsSellerOrBuyer(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.buyer == request.user or obj.seller == request.user


class OrderViewSet(viewsets.ReadOnlyModelViewSet):
    """
    list: Returns orders where user is buyer or seller.
    create_from_cart: Converts user's cart into grouped seller orders.
    update_status: Seller-only order status update (validated transitions).
    simulate_payment: Simulate payment flow.
    track: Returns timeline/tracking info for a given order.
    cancel_order: Buyer cancels before shipment.
    confirm_delivery: Buyer confirms delivery completion.
    review: Buyer posts review(s) for product(s) in a completed order.
    """
    queryset = Order.objects.select_related("buyer", "seller").prefetch_related("items", "status_history", "payment")
    serializer_class = OrderSerializer
    permission_classes = [permissions.IsAuthenticated, IsSellerOrBuyer]

    def get_queryset(self):
        user = self.request.user
        return Order.objects.filter(models.Q(buyer=user) | models.Q(seller=user)).order_by("-created_at")

    # ----------------------------------------------------------------------
    # 🧱 CREATE FROM CART
    # (unchanged)
    # ----------------------------------------------------------------------
    @action(detail=False, methods=["post"], url_path="create")
    def create_from_cart(self, request):
        cart, _ = Cart.objects.get_or_create(user=request.user)
        payment_method = request.data.get("payment_method", "COD").upper()
        if payment_method not in ["COD", "ONLINE"]:
            payment_method = "COD"
        items_qs = cart.items.select_related("product", "product__owner").all()
        if not items_qs.exists():
            return Response({"detail": "Cart is empty"}, status=status.HTTP_400_BAD_REQUEST)

        groups = defaultdict(list)
        invalid = []
        for ci in items_qs:
            prod = ci.product
            if not prod or prod.is_deleted or not prod.is_available:
                invalid.append(prod.title if prod else str(prod))
            else:
                groups[prod.owner].append(ci)

        if invalid:
            return Response({"detail": "Some products unavailable", "products": invalid},
                            status=status.HTTP_400_BAD_REQUEST)

        created_orders, created_cart_item_ids = [], []
        for seller, cart_items in groups.items():
            order = Order.objects.create(
                buyer=request.user,
                seller=seller,
                total_price=Decimal("0.00"),
            )
            Payment.objects.create(
                order=order,
                method="CARD" if payment_method == "ONLINE" else "COD",
                amount=order.total_price,
                status=Order.PAYMENT_PENDING if payment_method == "COD" else Order.PAYMENT_SUCCESS,
            )
            total = Decimal("0.00")
            for ci in cart_items:
                prod = ci.product
                OrderItem.objects.create(
                    order=order,
                    product=prod,
                    product_title=prod.title,
                    price=prod.price,
                    quantity=ci.quantity
                )
                total += prod.price * ci.quantity
                created_cart_item_ids.append(ci.id)
            order.total_price = total
            order.save()
            created_orders.append(order)

            # create initial history
            OrderStatusHistory.objects.create(
                order=order,
                from_status="",
                to_status=Order.STATUS_PENDING,
                actor=request.user,
                note="Order placed",
                timestamp=order.created_at
            )

            send_push_to_user(
                seller,
                "🛍 New Order Received",
                f"{request.user.name or request.user.email} placed an order for {len(cart_items)} item(s).",
                url=f"/orders/{order.id}/",
                type_="order"
            )

        CartItem.objects.filter(id__in=created_cart_item_ids).delete()
        serializer = OrderSerializer(created_orders, many=True, context={"request": request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # ----------------------------------------------------------------------
    # 🧱 SELLER: UPDATE STATUS
    # (unchanged)
    # ----------------------------------------------------------------------
    @action(detail=True, methods=["patch"], url_path="update_status")
    def update_status(self, request, pk=None):
        order = self.get_object()
        if request.user != order.seller:
            return Response({"detail": "Only seller may update status."}, status=status.HTTP_403_FORBIDDEN)

        new_status = (request.data.get("status") or "").upper()
        allowed_statuses = [s for s, _ in Order.STATUS_CHOICES]
        if not new_status or new_status not in allowed_statuses:
            return Response({"detail": "Invalid status."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order.set_status(new_status, actor=request.user, note=request.data.get("note"))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if new_status == Order.STATUS_PAID:
            order.payment_status = Order.PAYMENT_SUCCESS
            order.payment_id = order.payment_id or f"AUTO-{order.id}-{int(timezone.now().timestamp())}"
            order.save(update_fields=["payment_status", "payment_id"])

        message_map = {
            Order.STATUS_PENDING: "Your order is pending.",
            Order.STATUS_PAID: "Your payment was received.",
            Order.STATUS_SHIPPED: "Your order has been shipped! 🚚",
            Order.STATUS_DELIVERED: "Your order has been delivered. 🎁",
            Order.STATUS_COMPLETED: "Order completed — thank you for shopping! 🎉",
            Order.STATUS_CANCELLED: "Your order was cancelled. ❌",
        }

        send_push_to_user(
            order.buyer,
            f"Order {new_status.title()}",
            message_map.get(new_status, f"Your order #{order.id} status changed to {new_status}."),
            url=f"/orders/{order.id}/",
            type_="order_status",
            data={"order_id": order.id, "status": new_status}
        )

        return Response(OrderSerializer(order, context={"request": request}).data)

    # ----------------------------------------------------------------------
    # 🧱 BUYER: CANCEL ORDER
    # (unchanged)
    # ----------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="cancel")
    def cancel_order(self, request, pk=None):
        """Buyer cancels order if still pending or paid."""
        order = self.get_object()
        if request.user != order.buyer:
            return Response({"detail": "Only buyer can cancel this order."}, status=status.HTTP_403_FORBIDDEN)

        if order.status not in [Order.STATUS_PENDING, Order.STATUS_PAID]:
            return Response({"detail": f"Cannot cancel once {order.status.lower()}."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order.set_status(Order.STATUS_CANCELLED, actor=request.user, note="Cancelled by buyer")
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # restore product availability
        for item in order.items.all():
            if item.product:
                item.product.is_available = True
                item.product.save(update_fields=["is_available"])

        # notify seller
        send_push_to_user(
            order.seller,
            "❌ Order Cancelled",
            f"{order.buyer.name or order.buyer.email} cancelled order #{order.id}.",
            url=f"/orders/{order.id}/",
            type_="order_cancel",
            data={"order_id": order.id, "status": order.status}
        )

        return Response(OrderSerializer(order, context={"request": request}).data)

    # ----------------------------------------------------------------------
    # 🧱 BUYER: CONFIRM DELIVERY
    # (unchanged)
    # ----------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="confirm_delivery")
    def confirm_delivery(self, request, pk=None):
        """Buyer confirms delivery → mark order as DELIVERED."""
        order = self.get_object()

        # Only buyer can confirm delivery
        if request.user != order.buyer:
            return Response({"detail": "Only buyer can confirm delivery."}, status=status.HTTP_403_FORBIDDEN)

        # Allow only if shipped or already delivered
        if order.status not in [Order.STATUS_SHIPPED, Order.STATUS_DELIVERED]:
            return Response({"detail": "Order must be shipped before confirmation."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            order.set_status(Order.STATUS_DELIVERED, actor=request.user, note="Delivery confirmed by buyer")
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Notify seller that buyer confirmed delivery
        send_push_to_user(
            order.seller,
            "📦 Delivery Confirmed",
            f"{order.buyer.name or order.buyer.email} confirmed delivery for order #{order.id}.",
            url=f"/orders/{order.id}/",
            type_="order_delivered",
            data={"order_id": order.id, "status": order.status},
        )

        return Response(OrderSerializer(order, context={"request": request}).data)

    # ----------------------------------------------------------------------
    # 🧱 SIMULATE PAYMENT (unchanged)
    # ----------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="simulate_payment")
    def simulate_payment(self, request, pk=None):
        order = self.get_object()
        method = (request.data.get("method") or "COD").upper()
        result = (request.data.get("result") or "success").lower()

        payment, _ = Payment.objects.get_or_create(order=order, defaults={"method": method, "amount": order.total_price})
        payment.method = method
        payment.amount = order.total_price

        if result == "success":
            payment.status = Order.PAYMENT_SUCCESS
            order.payment_status = Order.PAYMENT_SUCCESS
            order.payment_id = f"SIM-{order.id}-{int(timezone.now().timestamp())}"
            payment.provider_payment_id = order.payment_id
            if order.status == Order.STATUS_PENDING:
                try:
                    order.set_status(Order.STATUS_PAID, actor=request.user, note="Auto-paid via simulate_payment")
                except ValueError:
                    pass
        else:
            payment.status = Order.PAYMENT_FAILED
            order.payment_status = Order.PAYMENT_FAILED

        payment.save()
        order.save()

        send_push_to_user(
            order.buyer,
            f"Payment {'Successful' if order.payment_status == Order.PAYMENT_SUCCESS else 'Failed'}",
            f"Payment for order #{order.id} was {order.payment_status}.",
            url=f"/orders/{order.id}/",
            type_="order_payment",
            data={"order_id": order.id, "payment_status": order.payment_status}
        )

        send_push_to_user(
            order.seller,
            f"Order #{order.id} Payment Status",
            f"Payment for order #{order.id} is {order.payment_status}.",
            url=f"/orders/{order.id}/",
            type_="order_payment",
            data={"order_id": order.id, "payment_status": order.payment_status}
        )

        return Response(OrderSerializer(order, context={"request": request}).data)

    # ----------------------------------------------------------------------
    # 🧱 TRACK ORDER (unchanged)
    # ----------------------------------------------------------------------
    @action(detail=True, methods=["get"], url_path="track")
    def track(self, request, pk=None):
        order = self.get_object()
        timeline_qs = order.status_history.order_by("timestamp").all()

        payment_events = []
        if hasattr(order, "payment") and order.payment is not None:
            payment = order.payment
            payment_events.append({
                "from_status": "",
                "to_status": "PAYMENT",
                "actor": None,
                "note": f"Payment {payment.status} (method={payment.method})",
                "timestamp": payment.created_at
            })

        history_serialized = []
        for h in timeline_qs:
            history_serialized.append({
                "id": h.id,
                "from_status": h.from_status,
                "to_status": h.to_status,
                "actor": {
                    "id": h.actor.id,
                    "email": getattr(h.actor, "email", None),
                    "name": getattr(h.actor, "name", None),
                } if h.actor else None,
                "note": h.note,
                "timestamp": h.timestamp,
            })

        combined = [{
            "id": None,
            "from_status": "",
            "to_status": Order.STATUS_PENDING,
            "actor": {
                "id": order.buyer.id,
                "email": order.buyer.email,
                "name": getattr(order.buyer, "name", None),
            },
            "note": "Order placed",
            "timestamp": order.created_at,
        }]
        for p in payment_events:
            combined.append({
                "id": None,
                "from_status": p["from_status"],
                "to_status": p["to_status"],
                "actor": p["actor"],
                "note": p["note"],
                "timestamp": p["timestamp"],
            })
        combined.extend(history_serialized)

        combined_sorted = sorted(combined, key=lambda d: d["timestamp"] or order.created_at)
        payload = {
            "order_id": order.id,
            "current_status": order.status,
            "timeline": combined_sorted,
            "created_at": order.created_at,
            "updated_at": order.updated_at,
        }
        serializer = OrderTrackingSerializer(payload)
        return Response(serializer.data)

    # ----------------------------------------------------------------------
    # 🧱 BUYER: REVIEW(S) FROM ORDER
    # ----------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="review")
    def review(self, request, pk=None):
        """
        Post one or multiple reviews for products in this order.

        Accepts either:
        - Single review body:
          { "product": 6, "rating": 5, "comment": "Nice" }

        - Or list:
          { "reviews": [ {product, rating, comment}, ... ] }

        Rules:
        - Only buyer of the order can post.
        - Order must be COMPLETED.
        - Product(s) must belong to this order.
        - Reuses ReviewSerializer which already enforces "product purchased in COMPLETED order".
        """
        order = self.get_object()

        # only buyer can post reviews from order
        if request.user != order.buyer:
            return Response({"detail": "Only buyer may post reviews from this order."}, status=status.HTTP_403_FORBIDDEN)

        # only allow reviews for completed orders
        if order.status != Order.STATUS_COMPLETED:
            return Response({"detail": "Cannot review until order is completed."}, status=status.HTTP_400_BAD_REQUEST)

        # gather permitted product ids for this order
        product_ids = set(order.items.values_list("product_id", flat=True))
        # remove possible None
        product_ids.discard(None)

        payload = request.data

        # normalize into list of review dicts
        reviews_payload = []
        if isinstance(payload.get("reviews"), list):
            reviews_payload = payload.get("reviews")
        elif "product" in payload and "rating" in payload:
            reviews_payload = [payload]
        else:
            return Response({"detail": "Invalid payload. Provide 'product'+'rating' or 'reviews' list."},
                            status=status.HTTP_400_BAD_REQUEST)

        created = []
        errors = {}

        for idx, rev in enumerate(reviews_payload):
            prod_id = rev.get("product")
            # check product belongs to this order
            if prod_id not in product_ids:
                errors[idx] = {"product": "Product is not part of this order."}
                continue

            # build a serializer instance to reuse its validation & create/update logic
            ser = ReviewSerializer(data={
                "product": prod_id,
                "rating": rev.get("rating"),
                "comment": rev.get("comment", "")
            }, context={"request": request})

            if not ser.is_valid():
                errors[idx] = ser.errors
                continue

            # save (this will update_or_create in serializer.create)
            review_obj = ser.save()
            created.append(ReviewSerializer(review_obj).data)

        if errors and not created:
            # nothing created, return errors
            return Response({"detail": "No reviews created", "errors": errors}, status=status.HTTP_400_BAD_REQUEST)

        return Response({"created": created, "errors": errors}, status=status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST)
    
        # ----------------------------------------------------------------------
    # 🧩 SELLER DASHBOARD ANALYTICS
    # ----------------------------------------------------------------------
    @action(detail=False, methods=["get"], url_path="seller/dashboard")
    def seller_dashboard(self, request):
        """
        Returns summarized analytics for the authenticated seller.
        Includes:
        - Order stats (total/completed/cancelled)
        - Revenue totals
        - Monthly sales trend
        - Top products
        - Seller rating summary
        """
        user = request.user
        if not user.is_authenticated:
            return Response({"detail": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)

        # Filter orders where this user is the seller
        seller_orders = Order.objects.filter(seller=user)

        total_orders = seller_orders.count()
        completed_orders = seller_orders.filter(status=Order.STATUS_COMPLETED).count()
        cancelled_orders = seller_orders.filter(status=Order.STATUS_CANCELLED).count()

        # Calculate total revenue (only completed)
        total_revenue = (
            seller_orders.filter(status=Order.STATUS_COMPLETED)
            .aggregate(total=models.Sum("total_price"))
            .get("total")
            or 0
        )

        # Monthly breakdown (for last 12 months)
        monthly_data = (
            seller_orders.filter(status=Order.STATUS_COMPLETED)
            .annotate(month=models.functions.TruncMonth("created_at"))
            .values("month")
            .annotate(total=models.Sum("total_price"))
            .order_by("month")
        )

        monthly_sales = [
            {"month": m["month"].strftime("%b %Y"), "revenue": float(m["total"])} for m in monthly_data
        ]

        # Top products (by revenue)
        top_products_qs = (
            OrderItem.objects.filter(order__seller=user, order__status=Order.STATUS_COMPLETED)
            .values("product__id", "product__title")
            .annotate(
                total_revenue=models.Sum(models.F("price") * models.F("quantity")),
                total_quantity=models.Sum("quantity"),
            )
            .order_by("-total_revenue")[:5]
        )
        top_products = [
            {
                "id": p["product__id"],
                "title": p["product__title"],
                "total_revenue": float(p["total_revenue"] or 0),
                "total_quantity": p["total_quantity"] or 0,
            }
            for p in top_products_qs
        ]

        data = {
            "seller": {
                "id": user.id,
                "email": user.email,
                "name": user.name,
                "rating": float(user.seller_rating),
                "total_reviews": user.total_reviews,
            },
            "stats": {
                "total_orders": total_orders,
                "completed_orders": completed_orders,
                "cancelled_orders": cancelled_orders,
                "total_revenue": float(total_revenue),
            },
            "monthly_sales": monthly_sales,
            "top_products": top_products,
        }

        return Response(data, status=status.HTTP_200_OK)
    
    @action(detail=True, methods=["post"], url_path="refund_request")
    def refund_request(self, request, pk=None):
        """Buyer requests refund for a paid/completed order."""
        order = self.get_object()

        if request.user != order.buyer:
            return Response({"detail": "Only buyer can request a refund."}, status=403)

        if order.status not in [Order.STATUS_PAID, Order.STATUS_SHIPPED, Order.STATUS_DELIVERED]:
            return Response({"detail": "Refund not allowed for this order status."}, status=400)


        if hasattr(order, "refund_request"):
            return Response({"detail": "Refund already requested for this order."}, status=400)

        reason = request.data.get("reason")
        if not reason:
            return Response({"detail": "Refund reason required."}, status=400)

        refund = RefundRequest.objects.create(
            order=order,
            buyer=request.user,
            seller=order.seller,
            reason=reason
        )

        # Notify seller
        notify_refund_status(order, refund, initiated=True)

        return Response(RefundRequestSerializer(refund).data, status=201)

        
    
    @action(detail=True, methods=["patch"], url_path="refund_decision")
    def refund_decision(self, request, pk=None):
        """
        Seller or admin approves/rejects a refund.
        If approved, attempts payment reversal via process_refund().
        Updates refund timeline and notifies buyer.
        """
        order = self.get_object()

        # safety check
        if RefundRequest is None:
            return Response({"detail": "Refund functionality not available."}, status=status.HTTP_501_NOT_IMPLEMENTED)

        refund = getattr(order, "refund_request", None)
        if refund is None:
            return Response({"detail": "No refund request found for this order."}, status=status.HTTP_404_NOT_FOUND)

        # permission check
        if request.user != order.seller and not request.user.is_staff:
            return Response({"detail": "Only seller or admin can decide on refunds."}, status=status.HTTP_403_FORBIDDEN)

        decision = (request.data.get("decision") or "").upper()
        note = request.data.get("note", "")

        if decision not in ["APPROVE", "REJECT"]:
            return Response({"detail": "Decision must be APPROVE or REJECT."}, status=status.HTTP_400_BAD_REQUEST)

        if getattr(refund, "status", "").upper() != getattr(RefundRequest, "STATUS_PENDING", "PENDING"):
            return Response({"detail": f"Refund already {refund.status.lower()}."}, status=status.HTTP_400_BAD_REQUEST)

        # perform decision
        try:
            if decision == "APPROVE":
                refund.approve(actor=request.user, note=note)

                # attempt refund processing (safe even if no real gateway)
                payment = getattr(order, "payment", None)
                success, msg = process_refund(payment, order=order, reason=refund.reason, simulate=True)

                # record refund result on model if supported
                if hasattr(refund, "processed"):
                    refund.processed = success
                if hasattr(refund, "processor_note"):
                    refund.processor_note = msg
                refund.save(update_fields=[
                    f for f in ("processed", "processor_note") if hasattr(refund, f)
                ])

                logger.info(
                    "Refund for order #%s processed (%s): %s",
                    order.id, "success" if success else "failed", msg
                )

            else:  # REJECT
                refund.reject(actor=request.user, note=note)

        except Exception as exc:
            logger.exception("Error updating refund #%s: %s", getattr(refund, "id", None), exc)
            return Response({"detail": "Error updating refund decision."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # notify buyer about refund decision
        try:
            if "notify_refund_status" in globals():
                notify_refund_status(order, refund)
            else:
                send_push_to_user(
                    refund.buyer,
                    f"Refund {refund.status.title()}",
                    f"Your refund request for order #{order.id} was {refund.status.lower()}.",
                    url=f"/orders/{order.id}/",
                    type_="refund_update",
                    data={"order_id": order.id, "refund_status": refund.status},
                )
        except Exception:
            logger.exception("Failed to send refund notification for order #%s", order.id)

        # serialize result
        if RefundRequestSerializer is None:
            return Response({"detail": "Refund decision saved but serializer unavailable."})

        return Response(RefundRequestSerializer(refund).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path="refund_status")
    def refund_status(self, request, pk=None):
        """Check refund status."""
        order = self.get_object()
        if not hasattr(order, "refund_request"):
            return Response({"refund": None})
        return Response(RefundRequestSerializer(order.refund_request).data)
    

    @action(detail=False, methods=["get"], url_path="seller/orders")
    def seller_orders(self, request):
        """Return all orders belonging to the logged-in seller."""
        seller = request.user
        if not seller.is_authenticated:
            return Response({"detail": "Authentication required."}, status=401)

        orders = (
            Order.objects.filter(seller=seller)
            .select_related("buyer")
            .prefetch_related("items__product")
            .order_by("-created_at")
        )

        # optional: limit for performance (e.g., recent 50)
        # orders = orders[:50]

        serializer = OrderSerializer(orders, many=True, context={"request": request})
        return Response(serializer.data)
    

    @action(detail=False, methods=["get"], url_path=r"seller/orders/(?P<order_id>\d+)")
    def seller_order_detail(self, request, order_id=None):
        """
        Return detailed info of a single order belonging to the logged-in seller.
        Works at /api/v1/orders/seller/orders/<id>/
        """
        user = request.user
        if not user.is_authenticated:
            return Response({"detail": "Authentication required."}, status=401)

        try:
            order = (
                Order.objects
                .select_related("buyer")
                .prefetch_related("items__product")
                .get(id=order_id, seller=user)
            )
        except Order.DoesNotExist:
            return Response({"detail": "Order not found or access denied."}, status=404)

        serializer = OrderSerializer(order, context={"request": request})
        return Response(serializer.data)



