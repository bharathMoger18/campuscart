# push/apps.py
from django.apps import AppConfig

class PushConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "push"

    def ready(self):
        import push.signals  # noqa
