import logging
import requests
import time
from typing import List, Optional

logger = logging.getLogger(__name__)


class PushNotificationService:
    """Сервис для отправки Push-уведомлений через Expo"""

    EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

    @classmethod
    def send_message_notification(cls, expo_tokens: List[str], sender_name: str, message_text: str,
                                  chat_id: Optional[int] = None):
        """
        Отправляет Push-уведомление о новом сообщение
        """
        logger.info(f"🔔 [PUSH] === STARTING PUSH NOTIFICATION ===")
        logger.info(f"🔔 [PUSH] Tokens count: {len(expo_tokens)}")
        logger.info(f"🔔 [PUSH] Sender: {sender_name}")
        logger.info(f"🔔 [PUSH] Message: {message_text[:50]}...")
        logger.info(f"🔔 [PUSH] Chat ID: {chat_id}")

        if not expo_tokens:
            logger.warning("No expo tokens provided")
            return False

        logger.info(f"Attempting to send push notification to {len(expo_tokens)} tokens")

        # Ограничиваем длину текста сообщения
        truncated_text = message_text[:100] + "..." if len(message_text) > 100 else message_text

        # Создаем уведомления для каждого токена
        messages = []
        for token in expo_tokens:
            logger.info(f"Processing token: {token[:20]}...")

            if not token or not token.startswith('ExponentPushToken'):
                logger.warning(f"Invalid token format: {token}")
                continue

            message = {
                "to": token,
                "title": f"💬 {sender_name}",
                "body": truncated_text,
                "data": {
                    "type": "message_notification",
                    "chatId": chat_id,
                    "timestamp": int(time.time()),
                    "sender_name": sender_name,
                },
                "sound": "default",
                "badge": 1,
                # Критически важно для фоновых уведомлений
                "priority": "high",
                "ttl": 2419200,
                "expiration": int(time.time()) + 2419200,
                # Android настройки
                "android": {
                    "channelId": "messages",
                    "priority": "high",  # Изменено с "max" на "high"
                    "sound": "default",
                    "vibrate": [0, 250, 250, 250],
                    "color": "#222222",
                    "sticky": False,
                    "collapse_key": f"chat_{chat_id}",
                    # Важно для фоновых уведомлений
                    "notification": {
                        "title": f"💬 {sender_name}",
                        "body": truncated_text,
                        "sound": "default",
                        "color": "#222222",
                        "priority": "high",
                    }
                },
                # iOS настройки
                "ios": {
                    "sound": "default",
                    "badge": 1,
                    "priority": "high",
                    "interruptionLevel": "active",
                    "_displayInForeground": True,
                    # Критически важно для iOS
                    "aps": {
                        "alert": {
                            "title": f"💬 {sender_name}",
                            "body": truncated_text,
                        },
                        "sound": "default",
                        "badge": 1,
                        "content-available": 1,  # Для фоновых уведомлений
                    }
                },
            }
            messages.append(message)

        if not messages:
            logger.warning("No valid messages to send")
            return False

        logger.info(f"Sending {len(messages)} push notifications")

        try:
            # Отправляем уведомления батчами по 100 штук
            batch_size = 100
            success_count = 0

            for i in range(0, len(messages), batch_size):
                batch = messages[i:i + batch_size]

                logger.info(f"Sending batch {i // batch_size + 1} with {len(batch)} notifications")

                response = requests.post(
                    cls.EXPO_PUSH_URL,
                    json=batch,
                    headers={
                        'Accept': 'application/json',
                        'Accept-Encoding': 'gzip, deflate',
                        'Content-Type': 'application/json',
                    },
                    timeout=30
                )

                logger.info(f"Expo API response status: {response.status_code}")
                logger.info(f"Expo API response body: {response.text}")

                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"Push notifications sent successfully: {len(batch)} messages")

                    # Проверяем на ошибки
                    for j, receipt in enumerate(result.get('data', [])):
                        if receipt.get('status') == 'error':
                            error_type = receipt.get('details', {}).get('error')
                            logger.error(f"Push notification error for token {batch[j]['to']}: {error_type}")

                            # Если токен недействителен, удаляем его из базы
                            if error_type in ['DeviceNotRegistered', 'InvalidCredentials']:
                                cls._handle_invalid_token(batch[j]['to'])
                        elif receipt.get('status') == 'ok':
                            logger.info(f"Push notification sent successfully to token {batch[j]['to'][:20]}...")
                            success_count += 1
                else:
                    logger.error(f"Failed to send push notifications: {response.status_code} - {response.text}")

            return success_count > 0

        except requests.exceptions.RequestException as e:
            logger.error(f"Network error sending push notifications: {str(e)}")
            return False
        except Exception as e:
            logger.error(f"Error sending push notifications: {str(e)}")
            return False

    @classmethod
    def _handle_invalid_token(cls, token: str):
        """Обрабатывает недействительные токены"""
        try:
            # Импорт здесь, чтобы избежать циклических зависимостей
            from authapp.models import CustomUser

            # Находим пользователя с этим токеном и удаляем его
            users = CustomUser.objects.filter(expo_push_token=token)
            for user in users:
                logger.info(f"Removing invalid push token for user {user.username}")
                user.expo_push_token = None
                user.save()

        except Exception as e:
            logger.error(f"Error handling invalid token {token}: {str(e)}")