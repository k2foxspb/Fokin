from django.urls import path, re_path

from callbackapp.consumer import MSGConsumer
from chatapp import consumers

websocket_urlpatterns = [
    path('ws', MSGConsumer.as_asgi()),
    re_path(r'ws/chat/(?P<room_name>[^/]+)', consumers.ChatConsumer.as_asgi()),
]