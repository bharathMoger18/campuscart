# chat/serializers.py
from rest_framework import serializers
from .models import Conversation, Message
from users.serializers import UserSerializer  # assuming you have this already

class MessageSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)

    class Meta:
        model = Message
        fields = ["id", "sender", "text", "timestamp", "read"]

class ConversationSerializer(serializers.ModelSerializer):
    participants = UserSerializer(many=True, read_only=True)
    messages = MessageSerializer(many=True, read_only=True)

    class Meta:
        model = Conversation
        fields = ["id", "product", "participants", "messages", "created_at"]
