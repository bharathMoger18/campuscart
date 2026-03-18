# push/urls.py
from django.urls import path
from .views import (
    PushSubscribeView,
    VAPIDPublicKeyView,
    push_test_page,
    SendPushDemoView,
    NotificationsListView,
    NotificationMarkReadView,
    NotificationMarkAllReadView,
    service_worker,
    notifications_dashboard,
)

urlpatterns = [
    path("push/subscribe/", PushSubscribeView.as_view(), name="push-subscribe"),
    path("push/public_key/", VAPIDPublicKeyView.as_view(), name="push-public-key"),
    path("push/test-page/", push_test_page, name="push-test-page"),
    path("push/send-demo/", SendPushDemoView.as_view(), name="push-send-demo"),

    # Notifications API
    path("push/notifications/", NotificationsListView.as_view(), name="push-notifications-list"),
    path("push/notifications/mark-all-read/", NotificationMarkAllReadView.as_view(), name="push-notifications-mark-all-read"),
    path("push/notifications/<int:pk>/mark-read/", NotificationMarkReadView.as_view(), name="push-notifications-mark-read"),

    # serve service worker at site root /sw.js if desired (optional)
    path("sw.js", service_worker, name="service-worker"),
    path("notifications/", notifications_dashboard, name="notifications-dashboard"),
]
