from django.urls import re_path

from chatapp.consumers import PrivateChatConsumer, NotificationConsumer, ChatConsumer

websocket_urlpatterns = [
    re_path(r"wss/notification/", NotificationConsumer.as_asgi()),
    re_path(r'wss/chat/(?P<room_name>[^/]+)', ChatConsumer.as_asgi()),
    re_path(r'wss/private/(?P<room_name>[^/]+)',PrivateChatConsumer.as_asgi()),
]