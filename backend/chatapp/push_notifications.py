import logging
import time
import requests
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

        # Отправляем уведомления через оба сервиса
        fcm_success = False
        expo_success = False

        # Отправляем через Firebase FCM если есть FCM токены
        if fcm_tokens_only:
            fcm_success = cls._send_firebase_notification(fcm_tokens_only, sender_name, message_text, chat_id)

        # Отправляем через Expo если есть Expo токены
        if expo_tokens:
            expo_success = cls._send_expo_notification(expo_tokens, sender_name, message_text, chat_id)

        # Возвращаем успех если хотя бы один из сервисов отработал
        overall_success = fcm_success or expo_success
        logger.info(f"🔔 [PUSH] === OVERALL PUSH RESULT: FCM={fcm_success}, Expo={expo_success}, Overall={overall_success} ===")

        return overall_success

    @classmethod
    def _send_expo_notification(cls, expo_tokens: List[str], sender_name: str, message_text: str, chat_id: Optional[int] = None):
        """Отправляет Push-уведомления через Expo Push Service"""
        logger.info(f"📱 [EXPO] Starting Expo push notification to {len(expo_tokens)} tokens")

        # Проверяем конфигурацию Expo
        from django.conf import settings
        has_expo_token = hasattr(settings, 'EXPO_ACCESS_TOKEN') and settings.EXPO_ACCESS_TOKEN
        logger.info(f"📱 [EXPO] 🔧 Configuration check: Expo Access Token {'✅ Present' if has_expo_token else '❌ Missing'}")

        if not has_expo_token:
            logger.warning("📱 [EXPO] ⚠️ No EXPO_ACCESS_TOKEN in settings. This might cause InvalidCredentials errors.")
            logger.warning("📱 [EXPO] 💡 To fix: Add EXPO_ACCESS_TOKEN to your Django settings with your Expo access token")

        # Ограничиваем длину текста сообщения
        truncated_text = message_text[:100] + "..." if len(message_text) > 100 else message_text

        # Подготавливаем сообщения для Expo
        messages = []
        for token in expo_tokens:
            message = {
                "to": token,
                "title": f"💬 {sender_name}",
                "body": truncated_text,
                "data": {
                    "type": "message_notification",
                    "chatId": str(chat_id) if chat_id else "",
                    "timestamp": str(int(time.time())),
                    "sender_name": sender_name,
                },
                "sound": "default",
                "badge": 1,
                "channelId": "messages"
            }
            messages.append(message)

        # Валидируем Expo токены перед отправкой
        valid_messages = []
        invalid_tokens = []

        for i, message in enumerate(messages):
            token = message["to"]
            # Проверяем формат Expo токена
            if not token.startswith('ExponentPushToken[') or not token.endswith(']'):
                logger.warning(f"📱 [EXPO] ⚠️ Invalid token format: {token[:30]}...")
                invalid_tokens.append(token)
            else:
                valid_messages.append(message)

        if invalid_tokens:
            logger.warning(f"📱 [EXPO] 🔍 Found {len(invalid_tokens)} invalid tokens, will be removed")
            for token in invalid_tokens:
                cls._handle_invalid_expo_token(token)

        if not valid_messages:
            logger.warning("📱 [EXPO] ⚠️ No valid tokens to send notifications")
            return False

        logger.info(f"📱 [EXPO] 📤 Proceeding with {len(valid_messages)} valid tokens")

        try:
            # Отправляем в Expo Push API
            expo_url = "https://exp.host/--/api/v2/push/send"
            headers = {
                'Accept': 'application/json',
                'Accept-encoding': 'gzip, deflate',
                'Content-Type': 'application/json',
                'User-Agent': 'Django-Expo-Push-Client/1.0'
            }

            # Добавляем Expo Access Token если доступен
            from django.conf import settings
            if hasattr(settings, 'EXPO_ACCESS_TOKEN') and settings.EXPO_ACCESS_TOKEN:
                headers['Authorization'] = f'Bearer {settings.EXPO_ACCESS_TOKEN}'
                logger.debug("📱 [EXPO] 🔐 Using Expo Access Token for authentication")

                # Проверяем формат токена
                token_preview = settings.EXPO_ACCESS_TOKEN[:20] + "..." if len(settings.EXPO_ACCESS_TOKEN) > 20 else settings.EXPO_ACCESS_TOKEN
                logger.debug(f"📱 [EXPO] 🔑 Token preview: {token_preview}")
            else:
                logger.warning("📱 [EXPO] 🔓 Sending requests without Expo Access Token - this may cause InvalidCredentials errors")

            # Отправляем батчами по 100 (лимит Expo)
            batch_size = 100
            success_count = 0
            failed_tokens = []

            for i in range(0, len(valid_messages), batch_size):
                batch_messages = valid_messages[i:i + batch_size]
                logger.info(f"📱 [EXPO] 📦 Sending batch {i // batch_size + 1}/{(len(valid_messages) - 1) // batch_size + 1} with {len(batch_messages)} notifications")

                try:
                    response = requests.post(expo_url, json=batch_messages, headers=headers, timeout=30)

                    if response.status_code == 200:
                        result = response.json()

                        if 'data' in result:
                            for idx, ticket in enumerate(result['data']):
                                if ticket.get('status') == 'ok':
                                    success_count += 1
                                    logger.debug(f"📱 [EXPO] ✅ Successfully sent to token {expo_tokens[i + idx][:30]}...")
                                else:
                                    error_details = ticket.get('details', {})
                                    error_message = error_details.get('error', 'Unknown error')
                                    token = expo_tokens[i + idx]

                                    # Подробное логирование ошибок
                                    logger.error(f"📱 [EXPO] ❌ Failed to send to token {token[:30]}...: {error_message}")
                                    if error_details:
                                        logger.error(f"📱 [EXPO] Error details: {error_details}")

                                    # Проверяем, является ли токен недействительным
                                    if error_message in ['DeviceNotRegistered', 'InvalidCredentials', 'MessageTooBig', 'MessageRateExceeded']:
                                        failed_tokens.append(token)
                                        logger.warning(f"📱 [EXPO] 🗑️ Marking token as invalid: {token[:30]}... (reason: {error_message})")

                                        # Специальная обработка для InvalidCredentials
                                        if error_message == 'InvalidCredentials':
                                            logger.error("📱 [EXPO] 🚨 InvalidCredentials error detected!")
                                            logger.error("📱 [EXPO] 🔧 Possible solutions:")
                                            logger.error("📱 [EXPO]   1. Check if EXPO_ACCESS_TOKEN is set in Django settings")
                                            logger.error("📱 [EXPO]   2. Verify your Expo project is properly configured for push notifications")
                                            logger.error("📱 [EXPO]   3. Ensure the mobile app is using the correct Expo SDK version")
                                            logger.error("📱 [EXPO]   4. Check if the Expo project has push notification permissions")
                    else:
                        logger.error(f"📱 [EXPO] HTTP error: {response.status_code} - {response.text}")

                except requests.exceptions.RequestException as e:
                    logger.error(f"📱 [EXPO] Request error: {str(e)}")
                    continue
                except Exception as e:
                    logger.error(f"📱 [EXPO] Unexpected error in batch: {str(e)}")
                    continue

            # Удаляем недействительные токены
            for token in failed_tokens:
                cls._handle_invalid_expo_token(token)

            logger.info(f"📱 [EXPO] === EXPO PUSH COMPLETED: {success_count} successful ===")
            return success_count > 0

        except Exception as e:
            logger.error(f"📱 [EXPO] Error in Expo push notification: {str(e)}")
            return False

    @classmethod
    def _send_firebase_notification(cls, fcm_tokens: List[str], sender_name: str, message_text: str, chat_id: Optional[int] = None):
        """Отправляет Push-уведомления через Firebase FCM"""
        logger.info(f"🔥 [FCM] Starting Firebase push notification to {len(fcm_tokens)} tokens")

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

    @classmethod
    def _handle_invalid_expo_token(cls, token: str):
        """Обрабатывает недействительные Expo токены"""
        try:
            # Импорт здесь, чтобы избежать циклических зависимостей
            from authapp.models import CustomUser

            # Находим пользователя с этим токеном и удаляем его
            # Предполагаем, что Expo токены также хранятся в fcm_token поле
            users = CustomUser.objects.filter(fcm_token=token)
            for user in users:
                logger.info(f"📱 [EXPO] Removing invalid Expo token for user {user.username}")
                user.fcm_token = None
                user.save()

        except Exception as e:
            logger.error(f"📱 [EXPO] Error handling invalid Expo token {token}: {str(e)}")