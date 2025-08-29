import logging
import time
from typing import List, Optional
from django.conf import settings
import firebase_admin
from firebase_admin import credentials, messaging

logger = logging.getLogger('chatapp.push_notifications')

logger.info("🔔 [PUSH] === PUSH NOTIFICATIONS MODULE LOADED (FIREBASE) ===")

class PushNotificationService:
    """Сервис для отправки Push-уведомлений через Firebase Cloud Messaging"""

    _firebase_app = None

    @classmethod
    def _initialize_firebase(cls):
        """Инициализация Firebase Admin SDK"""
        if cls._firebase_app is None:
            try:
                # Проверяем, инициализирован ли уже Firebase
                firebase_admin.get_app()
                logger.info("🔥 [FCM] Firebase app already initialized")
            except ValueError:
                # Firebase еще не инициализирован
                logger.info("🔥 [FCM] Initializing Firebase Admin SDK...")

                try:
                    if hasattr(settings, 'FIREBASE_CREDENTIALS_PATH') and settings.FIREBASE_CREDENTIALS_PATH:
                        logger.info("🔥 [FCM] Using Firebase credentials from file path")
                        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
                        cls._firebase_app = firebase_admin.initialize_app(cred)
                        logger.info("🔥 [FCM] ✅ Firebase initialized with credentials file")
                    elif hasattr(settings, 'FIREBASE_CREDENTIALS') and settings.FIREBASE_CREDENTIALS:
                        logger.info("🔥 [FCM] Using Firebase credentials from settings dict")
                        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS)
                        cls._firebase_app = firebase_admin.initialize_app(cred)
                        logger.info("🔥 [FCM] ✅ Firebase initialized with credentials dict")
                    else:
                        logger.error("🔥 [FCM] ❌ Firebase credentials not found in settings")
                        logger.error("🔥 [FCM] ❌ Expected FIREBASE_CREDENTIALS or FIREBASE_CREDENTIALS_PATH in settings")
                        raise ValueError("Firebase credentials not configured")

                except Exception as init_error:
                    logger.error(f"🔥 [FCM] ❌ Error during Firebase initialization: {str(init_error)}")
                    raise ValueError(f"Failed to initialize Firebase: {str(init_error)}")

    @classmethod
    def send_message_notification(cls, fcm_tokens: List[str], sender_name: str, message_text: str,
                                  chat_id: Optional[int] = None):
        """
        Отправляет Push-уведомление о новом сообщении через Firebase
        """
        logger.info(f"🔔 [PUSH] === STARTING FIREBASE PUSH NOTIFICATION ===")
        logger.info(f"🔔 [PUSH] Tokens count: {len(fcm_tokens)}")
        logger.info(f"🔔 [PUSH] Sender: {sender_name}")
        logger.info(f"🔔 [PUSH] Message: {message_text[:50]}...")
        logger.info(f"🔔 [PUSH] Chat ID: {chat_id}")

        if not fcm_tokens:
            logger.warning("🔥 [FCM] ❌ No FCM tokens provided")
            return False

        # Проверяем типы токенов
        expo_tokens = [token for token in fcm_tokens if token.startswith('ExponentPushToken')]
        fcm_tokens_only = [token for token in fcm_tokens if not token.startswith('ExponentPushToken')]

        if expo_tokens:
            logger.warning(f"🔥 [FCM] ⚠️ Detected {len(expo_tokens)} Expo tokens - these cannot be used with Firebase FCM!")
            for token in expo_tokens[:3]:  # Показываем только первые 3 для диагностики
                logger.warning(f"🔥 [FCM] ⚠️ Expo token: {token[:30]}...")

        if fcm_tokens_only:
            logger.info(f"🔥 [FCM] ✅ Found {len(fcm_tokens_only)} valid FCM tokens")
        else:
            logger.error(f"🔥 [FCM] ❌ No valid FCM tokens found! All tokens are Expo tokens.")
            return False

        # Продолжаем только с FCM токенами
        fcm_tokens = fcm_tokens_only

        # Инициализируем Firebase
        try:
            cls._initialize_firebase()
        except Exception as e:
            logger.error(f"Failed to initialize Firebase: {str(e)}")
            return False

        logger.info(f"Attempting to send push notification to {len(fcm_tokens)} tokens")

        # Ограничиваем длину текста сообщения
        truncated_text = message_text[:100] + "..." if len(message_text) > 100 else message_text

        # Создаем сообщение для Firebase
        try:
            # Данные для приложения
            data_payload = {
                "type": "message_notification",
                "chatId": str(chat_id) if chat_id else "",
                "timestamp": str(int(time.time())),
                "sender_name": sender_name,
            }

            # Создаем уведомление
            notification = messaging.Notification(
                title=f"💬 {sender_name}",
                body=truncated_text
            )

            # Настройки для Android
            android_config = messaging.AndroidConfig(
                ttl=2419200,  # 28 дней в секундах
                priority='high',
                notification=messaging.AndroidNotification(
                    title=f"💬 {sender_name}",
                    body=truncated_text,
                    sound='default',
                    color='#222222',
                    channel_id='messages'
                ),
                data=data_payload
            )

            # Настройки для iOS
            apns_config = messaging.APNSConfig(
                headers={'apns-priority': '10'},
                payload=messaging.APNSPayload(
                    aps=messaging.Aps(
                        alert=messaging.ApsAlert(
                            title=f"💬 {sender_name}",
                            body=truncated_text
                        ),
                        badge=1,
                        sound='default',
                        content_available=True
                    ),
                    custom_data=data_payload
                )
            )

            success_count = 0
            failed_tokens = []

            # Отправляем уведомления батчами по 500 штук (лимит Firebase)
            batch_size = 500

            for i in range(0, len(fcm_tokens), batch_size):
                batch_tokens = fcm_tokens[i:i + batch_size]

                logger.info(f"Sending batch {i // batch_size + 1} with {len(batch_tokens)} notifications")

                # Создаем multicast сообщение
                multicast_message = messaging.MulticastMessage(
                    notification=notification,
                    android=android_config,
                    apns=apns_config,
                    data=data_payload,
                    tokens=batch_tokens
                )

                try:
                    # Отправляем батч
                    response = messaging.send_multicast(multicast_message)

                    logger.info(f"Firebase batch response: {response.success_count}/{len(batch_tokens)} successful")

                    success_count += response.success_count

                    # Обрабатываем ошибки
                    if response.failure_count > 0:
                        for idx, resp in enumerate(response.responses):
                            if not resp.success:
                                token = batch_tokens[idx]
                                error = resp.exception
                                logger.error(f"Failed to send to token {token[:20]}...: {error}")

                                # Проверяем, является ли токен недействительным
                                if hasattr(error, 'code'):
                                    if error.code in ['UNREGISTERED', 'INVALID_ARGUMENT']:
                                        failed_tokens.append(token)
                                        logger.warning(f"Invalid token detected: {token[:20]}...")

                except Exception as e:
                    logger.error(f"Error sending Firebase batch: {str(e)}")
                    continue

            # Удаляем недействительные токены
            for token in failed_tokens:
                cls._handle_invalid_token(token)

            logger.info(f"🔔 [PUSH] === FIREBASE PUSH COMPLETED: {success_count} successful ===")
            return success_count > 0

        except Exception as e:
            logger.error(f"Error creating Firebase message: {str(e)}")
            return False

    @classmethod
    def _handle_invalid_token(cls, token: str):
        """Обрабатывает недействительные FCM токены"""
        try:
            # Импорт здесь, чтобы избежать циклических зависимостей
            from authapp.models import CustomUser

            # Находим пользователя с этим токеном и удаляем его
            # Предполагаем, что поле переименовано в fcm_token
            users = CustomUser.objects.filter(fcm_token=token)
            for user in users:
                logger.info(f"Removing invalid FCM token for user {user.username}")
                user.fcm_token = None
                user.save()

        except Exception as e:
            logger.error(f"Error handling invalid FCM token {token}: {str(e)}")