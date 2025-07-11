# backend/asgi.py
import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# Инициализируем Django ASGI приложение перед импортом
django_asgi_app = get_asgi_application()

# Импортируем после инициализации Django
from chatapp.middleware import HybridAuthMiddlewareStack
import chatapp.routing

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": AllowedHostsOriginValidator(
        HybridAuthMiddlewareStack(
            URLRouter(
                chatapp.routing.websocket_urlpatterns
            )
        )
    ),
})