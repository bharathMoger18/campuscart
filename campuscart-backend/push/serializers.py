# push/serializers.py
from rest_framework import serializers
from .models import PushSubscription, PushNotification


class PushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushSubscription
        fields = ["id", "endpoint", "p256dh", "auth", "created_at"]
        read_only_fields = ["id", "created_at"]


class PushNotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushNotification
        fields = [
            "id",
            "user",
            "title",
            "body",
            "url",
            "type",
            "data",
            "delivered",
            "read",
            "created_at",
        ]
        read_only_fields = ["id", "user", "delivered", "created_at"]
