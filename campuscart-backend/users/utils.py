# users/utils.py
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from django.core.mail import send_mail
from django.conf import settings

def send_verification_email(user, request):
    token = default_token_generator.make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    verify_url = f"{request.scheme}://{request.get_host()}/api/v1/auth/verify/{uid}/{token}/"
    subject = "Verify your email"
    message = f"Hi {user.name or user.email},\n\nClick the link below to verify your email:\n{verify_url}\n\nThank you!"
    send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email])

def send_password_reset_email(user, request):
    token = default_token_generator.make_token(user)
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    reset_url = f"{request.scheme}://{request.get_host()}/api/v1/auth/password_reset_confirm/{uid}/{token}/"
    subject = "Reset your password"
    message = f"Hi {user.name or user.email},\n\nClick below to reset your password:\n{reset_url}\n\nThank you!"
    send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [user.email])
