# campuscart/routing.py
from django.urls import re_path
from push.consumers import NotificationsConsumer
from chat.consumers import ChatConsumer

websocket_urlpatterns = [
    re_path(r"ws/chat/(?P<conversation_id>\d+)/$", ChatConsumer.as_asgi()),
    re_path(r"ws/notifications/$", NotificationsConsumer.as_asgi()),  # 🆕
]
