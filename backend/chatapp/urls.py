from autobahn.util import public
from django.urls import path

from .apps import ChatappConfig
from .views import IndexView, room_view, get_private_room, private_chat_view

app_name = ChatappConfig.name
urlpatterns = [
    path('', IndexView.as_view(), name='chat-index'),
    path(r'ws/<slug:room_name>/', room_view, name='chat-room'),
    path('ws/private/<str:room_name>/', private_chat_view, name='private_chat'),
    path('api/get_private_room/<str:username1>/<str:username2>/', get_private_room, name='get_private_room'),
]
