# chat/urls.py
from rest_framework.routers import DefaultRouter
from django.urls import path, include
from .views import ConversationViewSet, MessageViewSet

router = DefaultRouter()
router.register(r"conversations", ConversationViewSet, basename="conversation")

urlpatterns = [
    path("", include(router.urls)),
    path("conversations/<int:conversation_id>/messages/", MessageViewSet.as_view({"get": "list"}), name="conversation-messages"),
]
