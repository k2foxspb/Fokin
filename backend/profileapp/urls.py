from django.urls import path
from . import views
from .apps import ProfileappConfig
from .view_api import UserProfileAPIView, CurrentUserProfileAPIView, ChatHistoryView, UserListAPIView

app_name = ProfileappConfig.name
urlpatterns = [
    path('all_users/', views.all_users_view, name='all_users'),
    path('<slug:username>/', views.profile_view, name='profile'),
    path('api/users/', UserListAPIView.as_view(), name='api_users_list'),
    path('api/profile/me/', CurrentUserProfileAPIView.as_view(), name='api_profile_me'),
    path('api/profile/<str:username>/', UserProfileAPIView.as_view(), name='api_profile_user'),

    path('api/chat_history/<int:room_id>/', ChatHistoryView.as_view(), name='chat_history'),


]
