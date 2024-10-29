from django.urls import path

from . import views
from .apps import ChatappConfig

app_name = ChatappConfig.name
urlpatterns = [
    path('', views.index_view, name='chat-index'),
    path('<str:room_name>/', views.room_view, name='chat-room'),
]