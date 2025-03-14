from django.urls import path, re_path

from chatapp import consumers

websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<room_name>[^/]+)', consumers.ChatConsumer.as_asgi()),
]