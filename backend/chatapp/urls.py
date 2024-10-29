from django.urls import path

from .apps import ChatappConfig
from .views import IndexView, room_view

app_name = ChatappConfig.name
urlpatterns = [
    path('', IndexView.as_view(), name='chat-index'),
    path('<slug:room_name>/', room_view, name='chat-room'),
]