from django.urls import path, re_path

from chatapp import consumers
from chatapp.consumers import PrivateChatConsumer

websocket_urlpatterns = [
    re_path(r'wss/chat/(?P<room_name>[^/]+)', consumers.ChatConsumer.as_asgi()),
    re_path(r'wss/private/(?P<room_name>\w+)',PrivateChatConsumer.as_asgi()),
]