from autobahn.util import public
from django.urls import path, include

from .apps import ChatappConfig
from .consumers import NotificationConsumer
from .views import IndexView, room_view, get_private_room, private_chat_view, get_chat_history, \
    user_dialog_list

app_name = ChatappConfig.name
urlpatterns = [
    path('', IndexView.as_view(), name='chat-index'),
    path(r'wss/<slug:room_name>/', room_view, name='chat-room'),
    path(r'wss/private/<int:room_id>/', private_chat_view, name='private_chat'),
    path('api/get_private_room/<str:username1>/<str:username2>/', get_private_room, name='get_private_room'),
    path('api/chat_history/<int:room_id>/', get_chat_history, name='get_chat_history'),
    path('dialogs/', user_dialog_list, name='user_dialogs')

]
