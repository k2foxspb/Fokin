from django.urls import path
from . import views
from .apps import ProfileappConfig

app_name = ProfileappConfig.name
urlpatterns = [
    path('all_users/', views.all_users_view, name='all_users'),
    path('<slug:username>/', views.profile_view, name='profile'),

]
