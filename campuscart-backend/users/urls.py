# users/urls.py
from django.urls import path
from .views import RegisterView, MeView, VerifyEmailView, RequestPasswordResetView, PasswordResetConfirmView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .views import public_user_detail

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("users/me/", MeView.as_view(), name="me"),
    path("auth/verify/<uidb64>/<token>/", VerifyEmailView.as_view(), name="verify-email"),
    path("auth/password_reset/", RequestPasswordResetView.as_view(), name="password-reset"),
    path("auth/password_reset_confirm/<uidb64>/<token>/", PasswordResetConfirmView.as_view(), name="password-reset-confirm"),
    path('users/public/<int:user_id>/', public_user_detail, name='public_user_detail'),
]