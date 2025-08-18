
from django.urls import path


from authapp.apps import AuthappConfig
from authapp.view_api import (
    LoginAPIView, RegisterAPIView, PasswordResetAPIView, LogoutAPIView,
    VerifyEmailAPIView, ResendVerificationAPIView, update_push_token, ActivateUserAPIView, 
    UpdateUserStatusAPIView, ResetPasswordConfirmAPIView
)
from authapp.views import CustomLoginView, RegisterView, ProfileEditView, \
    EmailConfirmationSendView,ConfirmEmailView, EmailConfirmationFailedView,PrivacyPolicyView, \
    EmailConfirmedView, ResetPasswordConfirmView, ResetPasswordView, CustomLogoutView
    
from django.contrib.auth.views import PasswordResetCompleteView
app_name = AuthappConfig.name

urlpatterns = [
    # API endpoints
    path('api/login/', LoginAPIView.as_view(), name='api_login'),
    path('api/register/', RegisterAPIView.as_view(), name='api_register'),
    path('api/password-reset/', PasswordResetAPIView.as_view(), name='api_password_reset'),
    path('api/reset-password-confirm/', ResetPasswordConfirmAPIView.as_view(), name='api_reset_password_confirm'),
    path('api/logout/', LogoutAPIView.as_view(), name='api_logout'),
    path('api/verify-email/', VerifyEmailAPIView.as_view(), name='api_verify_email'),
    path('api/resend-verification/', ResendVerificationAPIView.as_view(), name='api_resend_verification'),
    path('api/activate-user/', ActivateUserAPIView.as_view(), name='api_activate_user'),
    path('api/update-user-status/', UpdateUserStatusAPIView.as_view(), name='api_update_user_status'),
    
    # Web views
    path("login/", CustomLoginView.as_view(), name="login"),
    path("logout/", CustomLogoutView.as_view(), name="logout"),
    path("registration/", RegisterView.as_view(), name="register"),
    path(
        "profile_edit/<int:pk>/",
        ProfileEditView.as_view(),
        name="profile_edit",
    ),
    
    path('password-reset/', ResetPasswordView.as_view(), name='password_reset'),
    path('password-reset-confirm/<uidb64>/<token>/',
         ResetPasswordConfirmView.as_view(),
         name='password_reset_confirm'),
    path('password-reset-complete/',
         PasswordResetCompleteView.as_view(),
         name='password_reset_comp'),
    path('email-confirmation-sent/', EmailConfirmationSendView.as_view(), name="email_confirmation_sent"),
    path('confirm-email/<str:uidb64>/<str:token>/', ConfirmEmailView.as_view(), name='conf_email'),
    path('confirm-email-failed/', EmailConfirmationFailedView.as_view(), name='fail_email'),
    path('privacy-policy', PrivacyPolicyView.as_view(), name="privacy_policy"),
    path('email-confirmed', EmailConfirmedView.as_view(), name="email_confirmed"),
    path('privacy-policy', PrivacyPolicyView.as_view(), name="privacy_policy"),
    path('api/update-push-token/', update_push_token, name='update-push-token'),
    path('api/activate-user/', ActivateUserAPIView.as_view(), name='activate_user'),
    path('api/update-user-status/', UpdateUserStatusAPIView.as_view(), name='update_user_status'),

]       
