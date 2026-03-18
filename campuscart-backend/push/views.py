# push/views.py
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status
from .models import PushSubscription
from .serializers import PushSubscriptionSerializer
import json


class PushSubscribeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """
        Save or update a push subscription.
        Expected payload (exactly what browser returns):
        {
          "endpoint": "...",
          "keys": { "p256dh": "...", "auth": "..." }
        }
        """
        endpoint = request.data.get("endpoint")
        keys = request.data.get("keys", {})
        p256dh = keys.get("p256dh")
        auth_key = keys.get("auth")
        if not endpoint or not p256dh or not auth_key:
            return Response({"detail": "invalid payload"}, status=status.HTTP_400_BAD_REQUEST)

        sub, created = PushSubscription.objects.update_or_create(
            user=request.user, endpoint=endpoint, defaults={"p256dh": p256dh, "auth": auth_key}
        )
        return Response(PushSubscriptionSerializer(sub).data, status=status.HTTP_200_OK)

    def delete(self, request):
        endpoint = request.data.get("endpoint")
        if not endpoint:
            return Response({"detail": "endpoint required"}, status=status.HTTP_400_BAD_REQUEST)
        PushSubscription.objects.filter(user=request.user, endpoint=endpoint).delete()
        return Response({"detail": "deleted"}, status=status.HTTP_200_OK)


class VAPIDPublicKeyView(APIView):
    """
    Public key endpoint so frontend can fetch the VAPID public key.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"publicKey": settings.VAPID_PUBLIC_KEY})


# push/ui debug pages & service worker serving
from django.shortcuts import render

def push_test_page(request):
    """Simple frontend page to test push subscription."""
    return render(request, "push_test.html")


from django.http import FileResponse
from django.conf import settings
import os

def service_worker(request):
    """
    Serve the Service Worker file from /static/sw.js
    """
    sw_path = os.path.join(settings.BASE_DIR, "static", "sw.js")
    return FileResponse(open(sw_path, "rb"), content_type="application/javascript")


from pywebpush import webpush, WebPushException
from rest_framework.permissions import IsAuthenticated
from .models import PushSubscription, PushNotification
from .serializers import PushNotificationSerializer


class SendPushDemoView(APIView):
    """Send a test notification to the current user."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.conf import settings
        from .models import PushSubscription

        # allow custom title/body via request for testing
        title = request.data.get("title", "CampusCart Demo Notification 🎉")
        body = request.data.get("body", "This is a real push notification from your Django backend!")
        url = request.data.get("url", "/")
        type_ = request.data.get("type", "general")
        data = request.data.get("data", {})

        subs = PushSubscription.objects.filter(user=request.user)
        if not subs.exists():
            # create log entry
            PushNotification.objects.create(
                user=request.user, title=title, body=body, url=url, type=type_, data=data, delivered=False
            )
            return Response({"detail": "No subscription found for user"}, status=404)

        success = 0
        for sub in subs:
            try:
                webpush(
                    subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=json.dumps({"title": title, "body": body, "url": url, "type": type_, "data": data}),
                    vapid_private_key=settings.VAPID_PRIVATE_KEY,
                    vapid_claims={"sub": settings.VAPID_EMAIL},
                )
                success += 1
            except WebPushException as ex:
                # best-effort: remove invalid subs
                try:
                    sub.delete()
                except Exception:
                    pass

        # Log notification
        PushNotification.objects.create(
            user=request.user, title=title, body=body, url=url, type=type_, data=data, delivered=(success > 0)
        )
        return Response({"detail": f"Sent to {success} subscription(s)"})


# -------------------------
# Notifications API
# -------------------------
from rest_framework import generics, permissions
from .serializers import PushNotificationSerializer


class NotificationsListView(generics.ListAPIView):
    """
    List current user's notifications (most recent first).
    """
    permission_classes = [IsAuthenticated]
    serializer_class = PushNotificationSerializer

    def get_queryset(self):
        return PushNotification.objects.filter(user=self.request.user).order_by("-created_at")


class NotificationMarkReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            notif = PushNotification.objects.get(pk=pk, user=request.user)
        except PushNotification.DoesNotExist:
            return Response({"detail": "Not found"}, status=404)
        notif.read = True
        notif.save(update_fields=["read"])
        return Response(PushNotificationSerializer(notif).data)


class NotificationMarkAllReadView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        PushNotification.objects.filter(user=request.user, read=False).update(read=True)
        return Response({"detail": "all marked read"})


# push/views.py (append at bottom)

from django.contrib.auth.decorators import login_required
from django.shortcuts import render
from .models import PushNotification

@login_required
def notifications_dashboard(request):
    if request.method == "POST":
        PushNotification.objects.filter(user=request.user, read=False).update(read=True)

    notifications = PushNotification.objects.filter(user=request.user).order_by("-created_at")[:50]
    return render(request, "notifications_dashboard.html", {
        "notifications": notifications,
        "user": request.user,
    })
