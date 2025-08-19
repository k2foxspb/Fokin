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
        if not expo_tokens:
            logger.warning("No expo tokens provided")
            return

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
                    "timestamp": int(time.time())
                },
                "sound": "default",
                "priority": "high",
                "channelId": "messages",
                "badge": 1,
                "android": {
                    "channelId": "messages",
                    "priority": "high",
                    "sound": "default",
                },
                "ios": {
                    "sound": "default",
                    "badge": 1,
                }
            }
            messages.append(message)

        if not messages:
            logger.warning("No valid messages to send")
            return

        logger.info(f"Sending {len(messages)} push notifications")

        try:
            # Отправляем уведомления батчами по 100 штук
            batch_size = 100
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
                    timeout=10
                )

                logger.info(f"Expo API response status: {response.status_code}")
                logger.info(f"Expo API response body: {response.text}")

                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"Push notifications sent successfully: {len(batch)} messages")

                    # Проверяем на ошибки
                    for i, receipt in enumerate(result.get('data', [])):
                        if receipt.get('status') == 'error':
                            error_type = receipt.get('details', {}).get('error')
                            logger.error(f"Push notification error for token {batch[i]['to']}: {error_type}")

                            # Если токен недействителен, можно его удалить из базы
                            if error_type in ['DeviceNotRegistered', 'InvalidCredentials']:
                                cls._handle_invalid_token(batch[i]['to'])
                        elif receipt.get('status') == 'ok':
                            logger.info(f"Push notification sent successfully to token {batch[i]['to'][:20]}...")
                else:
                    logger.error(f"Failed to send push notifications: {response.status_code} - {response.text}")

        except requests.exceptions.RequestException as e:
            logger.error(f"Network error sending push notifications: {str(e)}")
        except Exception as e:
            logger.error(f"Error sending push notifications: {str(e)}")