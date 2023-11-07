from django.contrib.auth.views import LoginView, LogoutView
from django.urls import path


from authapp.apps import AuthappConfig
from authapp.views import CustomLoginView, RegisterView, ProfileEditView

app_name = AuthappConfig.name

urlpatterns = [
    path("login/", CustomLoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("registration/", RegisterView.as_view(), name="register"),
    path(
        "profile_edit/<int:pk>/",
        ProfileEditView.as_view(),
        name="profile_edit",
    ),
]
