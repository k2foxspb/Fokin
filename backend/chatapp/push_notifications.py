import requests
import json
import logging
from django.conf import settings
from typing import List, Optional

logger = logging.getLogger(__name__)

class PushNotificationService:
    """Сервис для отправки Push-уведомлений через Expo"""

    EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

    @classmethod
    def send_message_notification(cls, expo_tokens: List[str], sender_name: str, message_text: str, chat_id: Optional[int] = None):
        """
        Отправляет Push-уведомление о новом сообщении

        Args:
            expo_tokens: Список Expo Push токенов получателей
            sender_name: Имя отправителя сообщения
            message_text: Текст сообщения
            chat_id: ID чата (опционально)
        """
        if not expo_tokens:
            return

        # Ограничиваем длину текста сообщения
        truncated_text = message_text[:100] + "..." if len(message_text) > 100 else message_text

        # Создаем уведомления для каждого токена
        messages = []
        for token in expo_tokens:
            if not token or not token.startswith('ExponentPushToken'):
                continue

            message = {
                "to": token,
                "title": f"💬 {sender_name}",
                "body": truncated_text,
                "data": {
                    "type": "message_notification",
                    "chatId": chat_id,
                    "timestamp": int(time.time())
                },
                "sound": "default",
                "priority": "high",
                "channelId": "messages"
            }
            messages.append(message)

        if not messages:
            return

        try:
            # Отправляем уведомления батчами по 100 штук
            batch_size = 100
            for i in range(0, len(messages), batch_size):
                batch = messages[i:i + batch_size]

                response = requests.post(
                    cls.EXPO_PUSH_URL,
                    json=batch,
                    headers={
                        'Accept': 'application/json',
                        'Accept-Encoding': 'gzip, deflate',
                        'Content-Type': 'application/json',
                    },
                    timeout=10
                )

                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"Push notifications sent successfully: {len(batch)} messages")

                    # Проверяем на ошибки
                    for i, receipt in enumerate(result.get('data', [])):
                        if receipt.get('status') == 'error':
                            error_type = receipt.get('details', {}).get('error')
                            logger.warning(f"Push notification error for token {batch[i]['to']}: {error_type}")

                            # Если токен недействителен, можно его удалить из базы
                            if error_type in ['DeviceNotRegistered', 'InvalidCredentials']:
                                cls._handle_invalid_token(batch[i]['to'])
                else:
                    logger.error(f"Failed to send push notifications: {response.status_code} - {response.text}")

        except requests.exceptions.RequestException as e:
            logger.error(f"Network error sending push notifications: {str(e)}")
        except Exception as e:
            logger.error(f"Error sending push notifications: {str(e)}")

    @classmethod
    def _handle_invalid_token(cls, token: str):
        """Обрабатывает недействительные токены"""
        try:
            # Импорт здесь, чтобы избежать циклических зависимостей
            from authapp.models import CustomUser

            # Находим пользователя с этим токеном и удаляем его
            users = CustomUser.objects.filter(expo_push_token=token)
            for user in users:
                user.expo_push_token = None
                user.save()
                logger.info(f"Removed invalid push token for user {user.username}")

        except Exception as e:
            logger.error(f"Error handling invalid token {token}: {str(e)}")

import time
