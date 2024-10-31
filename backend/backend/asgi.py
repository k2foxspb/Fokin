"""
ASGI config for backend project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/4.2/howto/deployment/asgi/
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
os.environ.setdefault("DJANGO_SETTINGS_MODULE", 'backend.settings')
django_asgi_app = get_asgi_application()

from chatapp import routing


application = ProtocolTypeRouter({
  'http': django_asgi_app,
  'websocket': AllowedHostsOriginValidator(AuthMiddlewareStack(
        URLRouter(
            routing.websocket_urlpatterns
        )
    ),)
})