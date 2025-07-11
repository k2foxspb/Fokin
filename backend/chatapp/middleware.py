# chatapp/middleware.py
import logging
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from django.contrib.auth.models import AnonymousUser
from django.db import close_old_connections
from rest_framework.authtoken.models import Token
from authapp.models import CustomUser
from django.contrib.sessions.models import Session
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)


@database_sync_to_async
def get_user_from_token(token_key):
    try:
        token = Token.objects.get(key=token_key)
        return token.user
    except Token.DoesNotExist:
        return AnonymousUser()


@database_sync_to_async
def get_user_from_session(session_key):
    try:
        if not session_key:
            return AnonymousUser()

        session = Session.objects.get(session_key=session_key)
        session_data = session.get_decoded()
        user_id = session_data.get('_auth_user_id')

        if user_id:
            User = get_user_model()
            return User.objects.get(pk=user_id)

        return AnonymousUser()
    except (Session.DoesNotExist, User.DoesNotExist):
        return AnonymousUser()


class HybridAuthMiddleware(BaseMiddleware):
    """
    Middleware который поддерживает как Session, так и Token аутентификацию
    """

    def __init__(self, inner):
        super().__init__(inner)

    async def __call__(self, scope, receive, send):
        close_old_connections()

        # Проверяем токен
        token_key = self.extract_token_from_scope(scope)

        if token_key:
            # Используем token аутентификацию
            scope['user'] = await get_user_from_token(token_key)
            logger.info(f"WebSocket token auth: {scope['user']} (anonymous: {scope['user'].is_anonymous})")
        else:
            # Используем session аутентификацию
            session_key = self.extract_session_from_scope(scope)
            scope['user'] = await get_user_from_session(session_key)
            logger.info(f"WebSocket session auth: {scope['user']} (anonymous: {scope['user'].is_anonymous})")

        return await super().__call__(scope, receive, send)

    def extract_token_from_scope(self, scope):
        """Извлекает токен из scope"""
        token_key = None

        # Проверяем query string для токена
        query_string = scope.get('query_string', b'').decode()
        if 'token=' in query_string:
            for param in query_string.split('&'):
                if param.startswith('token='):
                    token_key = param.split('=')[1]
                    break

        # Проверяем headers для токена
        if not token_key:
            headers = dict(scope.get('headers', []))
            auth_header = headers.get(b'authorization', b'').decode()
            if auth_header.startswith('Token '):
                token_key = auth_header.split(' ')[1]

        return token_key

    def extract_session_from_scope(self, scope):
        """Извлекает session key из scope"""
        headers = dict(scope.get('headers', []))
        cookie_header = headers.get(b'cookie', b'').decode()

        if cookie_header:
            # Ищем sessionid в cookies
            for cookie in cookie_header.split(';'):
                cookie = cookie.strip()
                if cookie.startswith('sessionid='):
                    return cookie.split('=')[1]

        return None


def HybridAuthMiddlewareStack(inner):
    """
    Middleware stack который поддерживает и Session и Token аутентификацию
    """
    return HybridAuthMiddleware(inner)