
from django.urls import path


from authapp.apps import AuthappConfig
from authapp.views import CustomLoginView, RegisterView, ProfileEditView, \
    EmailConfirmationSendView,ConfirmEmailView, EmailConfirmationFailedView,PrivacyPolicyView, \
    EmailConfirmedView, ResetPasswordConfirmView, ResetPasswordView, CustomLogoutView
    
from django.contrib.auth.views import PasswordResetCompleteView
app_name = AuthappConfig.name

urlpatterns = [
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

]       
