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
        Отправляет Push-уведомление о новом сообщении ТОЛЬКО через Firebase FCM
        """
        logger.info(f"🔔 [PUSH] === STARTING FIREBASE FCM PUSH NOTIFICATION ===")
        logger.info(f"🔔 [PUSH] Received parameters:")
        logger.info(f"🔔 [PUSH]   fcm_tokens: {fcm_tokens}")
        logger.info(f"🔔 [PUSH]   tokens count: {len(fcm_tokens)}")
        logger.info(f"🔔 [PUSH]   sender_name: {sender_name}")
        logger.info(f"🔔 [PUSH]   message_text: {message_text[:100]}...")
        logger.info(f"🔔 [PUSH]   chat_id: {chat_id}")

        # ПРОВЕРКА 1: Есть ли токены вообще?
        if not fcm_tokens:
            logger.error("🔥 [FCM] ❌ EARLY RETURN: No FCM tokens provided")
            cls._suggest_token_migration()
            return False

        logger.info(f"🔔 [PUSH] ✅ CHECK 1 PASSED: {len(fcm_tokens)} tokens provided")

        # ПРОВЕРКА 2: Фильтруем и удаляем Expo токены из базы данных
        logger.info(f"🔔 [PUSH] === TOKEN FILTERING ===")
        expo_tokens = [token for token in fcm_tokens if token.startswith('ExponentPushToken')]
        fcm_tokens_only = [token for token in fcm_tokens if not token.startswith('ExponentPushToken')]

        logger.info(f"🔔 [PUSH] Filtering results:")
        logger.info(f"🔔 [PUSH]   Original tokens: {len(fcm_tokens)}")
        logger.info(f"🔔 [PUSH]   Expo tokens found: {len(expo_tokens)}")
        logger.info(f"🔔 [PUSH]   FCM tokens remaining: {len(fcm_tokens_only)}")

        # Массово удаляем все найденные Expo токены
        if expo_tokens:
            logger.warning(f"🔥 [FCM] 🚨 FOUND {len(expo_tokens)} Expo tokens - cleaning from DB")
            for i, token in enumerate(expo_tokens):
                logger.warning(f"🔥 [FCM] Expo token {i+1}: {token[:30]}...")

            cls._cleanup_expo_tokens(expo_tokens)
            cls._cleanup_all_expo_tokens()

        # ПРОВЕРКА 3: Остались ли валидные FCM токены?
        if not fcm_tokens_only:
            logger.error("🔥 [FCM] ❌ EARLY RETURN: No valid FCM tokens found after filtering")
            if expo_tokens:
                logger.error("🔥 [FCM] ❌ All provided tokens were Expo tokens - removed from DB")
                logger.error("🔥 [FCM] 💡 Users need to restart app to get new FCM tokens")
            else:
                logger.error("🔥 [FCM] ❌ Tokens were filtered out for unknown reason")

            cls._suggest_token_migration()
            return False

        logger.info(f"🔔 [PUSH] ✅ CHECK 3 PASSED: {len(fcm_tokens_only)} valid FCM tokens")

        # Логируем финальные токены которые будут отправлены
        for i, token in enumerate(fcm_tokens_only):
            logger.info(f"🔔 [PUSH] Final FCM token {i+1}: {token[:30]}...")

        logger.info(f"🔔 [PUSH] === CALLING _send_firebase_notification ===")

        # Отправляем ТОЛЬКО через Firebase FCM
        try:
            fcm_success = cls._send_firebase_notification(fcm_tokens_only, sender_name, message_text, chat_id)
            logger.info(f"🔔 [PUSH] _send_firebase_notification returned: {fcm_success}")
        except Exception as send_error:
            logger.error(f"🔔 [PUSH] ❌ _send_firebase_notification threw exception: {send_error}")
            fcm_success = False

        logger.info(f"🔔 [PUSH] === FCM PUSH RESULT: {fcm_success} ===")

        # Показываем статистику токенов для отслеживания миграции
        if not fcm_success:
            logger.info(f"🔔 [PUSH] Push failed, showing token statistics...")
            cls.get_token_statistics()
        else:
            logger.info(f"🔔 [PUSH] ✅ Push notification sent successfully!")

        return fcm_success

    # Метод удален - используется только Firebase FCM
    # Expo токены больше не поддерживаются

    @classmethod
    def _send_firebase_notification(cls, fcm_tokens: List[str], sender_name: str, message_text: str, chat_id: Optional[int] = None):
        """Отправляет Push-уведомления через Firebase FCM"""
        logger.info(f"🔥 [FCM] === STARTING FIREBASE NOTIFICATION PROCESS ===")
        logger.info(f"🔥 [FCM] Tokens to send to: {len(fcm_tokens)}")
        logger.info(f"🔥 [FCM] First token preview: {fcm_tokens[0][:30] if fcm_tokens else 'None'}...")
        logger.info(f"🔥 [FCM] Sender: {sender_name}")
        logger.info(f"🔥 [FCM] Message: {message_text[:50]}...")
        logger.info(f"🔥 [FCM] Chat ID: {chat_id}")

        # Проверяем, что токены переданы
        if not fcm_tokens:
            logger.error(f"🔥 [FCM] ❌ No tokens provided to _send_firebase_notification")
            return False

        # Инициализируем Firebase
        logger.info(f"🔥 [FCM] Step 1: Initializing Firebase...")
        try:
            cls._initialize_firebase()
            logger.info(f"🔥 [FCM] ✅ Firebase initialized successfully")
        except Exception as e:
            logger.error(f"🔥 [FCM] ❌ Failed to initialize Firebase: {str(e)}")
            logger.error(f"🔥 [FCM] ❌ Check firebase-service-account.json and project configuration")
            return False

        logger.info(f"🔥 [FCM] Step 2: Creating Firebase message...")

        # Ограничиваем длину текста сообщения
        truncated_text = message_text[:100] + "..." if len(message_text) > 100 else message_text

        # Создаем сообщение для Firebase
        try:
            logger.info(f"🔥 [FCM] Creating message payload...")

            # Данные для приложения
            data_payload = {
                "type": "message_notification",
                "chatId": str(chat_id) if chat_id else "",
                "timestamp": str(int(time.time())),
                "sender_name": sender_name,
            }

            logger.info(f"🔥 [FCM] Data payload: {data_payload}")

            # Создаем уведомление
            logger.info(f"🔥 [FCM] Creating notification object...")
            notification = messaging.Notification(
                title=f"💬 {sender_name}",
                body=truncated_text
            )
            logger.info(f"🔥 [FCM] ✅ Notification object created")

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

            logger.info(f"🔥 [FCM] === STARTING BATCH SENDING ===")
            logger.info(f"🔥 [FCM] Total tokens: {len(fcm_tokens)}, batch size: {batch_size}")

            for i in range(0, len(fcm_tokens), batch_size):
                batch_tokens = fcm_tokens[i:i + batch_size]
                batch_num = i // batch_size + 1

                logger.info(f"🔥 [FCM] === PROCESSING BATCH {batch_num} ===")
                logger.info(f"🔥 [FCM] Batch {batch_num}: {len(batch_tokens)} tokens")

                # Создаем multicast сообщение
                logger.info(f"🔥 [FCM] Creating multicast message for batch {batch_num}...")
                try:
                    multicast_message = messaging.MulticastMessage(
                        notification=notification,
                        android=android_config,
                        apns=apns_config,
                        data=data_payload,
                        tokens=batch_tokens
                    )
                    logger.info(f"🔥 [FCM] ✅ Multicast message created for batch {batch_num}")
                except Exception as msg_error:
                    logger.error(f"🔥 [FCM] ❌ Error creating multicast message: {msg_error}")
                    continue

                try:
                    logger.info(f"🔥 [FCM] Sending batch {batch_num} to Firebase...")
                    # Отправляем батч
                    response = messaging.send_multicast(multicast_message)

                    logger.info(f"🔥 [FCM] ✅ Batch {batch_num} response received")
                    logger.info(f"🔥 [FCM] Batch {batch_num} result: {response.success_count}/{len(batch_tokens)} successful")

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

            logger.info(f"🔥 [FCM] === FIREBASE PUSH SUMMARY ===")
            logger.info(f"🔥 [FCM] Total successful: {success_count}")
            logger.info(f"🔥 [FCM] Total failed tokens: {len(failed_tokens)}")
            logger.info(f"🔥 [FCM] Success rate: {(success_count/len(fcm_tokens))*100:.1f}%")
            logger.info(f"🔔 [PUSH] === FIREBASE PUSH COMPLETED: {success_count} successful ===")

            final_result = success_count > 0
            logger.info(f"🔥 [FCM] Final result: {final_result}")
            return final_result

        except Exception as e:
            logger.error(f"🔥 [FCM] ❌ CRITICAL ERROR creating Firebase message: {str(e)}")
            logger.error(f"🔥 [FCM] ❌ Error type: {type(e).__name__}")
            import traceback
            logger.error(f"🔥 [FCM] ❌ Full traceback: {traceback.format_exc()}")
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
                logger.info(f"🚨 [CLEANUP] Удаление Expo токена для пользователя {user.username}")
                user.fcm_token = None
                user.save()

        except Exception as e:
            logger.error(f"🚨 [CLEANUP] Ошибка удаления Expo токена {token}: {str(e)}")

    @classmethod
    def _cleanup_expo_tokens(cls, expo_tokens: List[str]):
        """Очистка конкретных Expo токенов из базы данных"""
        try:
            from authapp.models import CustomUser

            for token in expo_tokens:
                users = CustomUser.objects.filter(fcm_token=token)
                for user in users:
                    logger.warning(f"🚨 [CLEANUP] Удаление Expo токена для пользователя {user.username}")
                    user.fcm_token = None
                    user.save()

            logger.info(f"🚨 [CLEANUP] Очищено {len(expo_tokens)} конкретных Expo токенов")

        except Exception as e:
            logger.error(f"🚨 [CLEANUP] Ошибка при очистке Expo токенов: {str(e)}")

    @classmethod
    def _cleanup_all_expo_tokens(cls):
        """Полная очистка всех Expo токенов из базы данных"""
        try:
            from authapp.models import CustomUser

            # Находим всех пользователей с Expo токенами
            users_with_expo_tokens = CustomUser.objects.filter(
                fcm_token__startswith='ExponentPushToken['
            )

            count = users_with_expo_tokens.count()
            if count > 0:
                logger.warning(f"🚨 [CLEANUP] Найдено {count} пользователей с Expo токенами - начинаем массовую очистку")

                # Массовое обновление - очищаем все Expo токены
                updated_count = users_with_expo_tokens.update(fcm_token=None)

                logger.info(f"🚨 [CLEANUP] ✅ Очищено {updated_count} Expo токенов из базы данных")
                logger.info(f"🚨 [CLEANUP] ✅ Пользователи должны перезапустить приложение для получения новых FCM токенов")
                logger.info(f"🚨 [CLEANUP] 💡 Expo токены больше не поддерживаются - только Firebase FCM")
            else:
                logger.info("🚨 [CLEANUP] ✅ Expo токены в базе данных не найдены")

        except Exception as e:
            logger.error(f"🚨 [CLEANUP] Ошибка при массовой очистке Expo токенов: {str(e)}")

    @classmethod
    def _suggest_token_migration(cls):
        """Предлагает пользователям мигрировать на FCM токены"""
        logger.warning("🔥 [FCM] 📋 МИГРАЦИЯ НА FIREBASE FCM ТОКЕНЫ")
        logger.warning("🔥 [FCM] 📱 Для пользователей мобильного приложения:")
        logger.warning("🔥 [FCM]   1. Полностью закройте приложение")
        logger.warning("🔥 [FCM]   2. Перезапустите приложение")
        logger.warning("🔥 [FCM]   3. При необходимости разрешите push-уведомления заново")
        logger.warning("🔥 [FCM]   4. Приложение автоматически получит новый FCM токен")
        logger.warning("🔥 [FCM] 🔧 Для администраторов:")
        logger.warning("🔥 [FCM]   - Убедитесь что Firebase настроен в мобильном приложении")
        logger.warning("🔥 [FCM]   - Проверьте google-services.json в проекте")
        logger.warning("🔥 [FCM]   - Firebase credentials настроены в Django settings")

    @classmethod
    def get_token_statistics(cls):
        """Получает статистику по токенам в базе данных"""
        try:
            from authapp.models import CustomUser

            total_users = CustomUser.objects.count()
            users_with_tokens = CustomUser.objects.exclude(fcm_token__isnull=True).exclude(fcm_token='').count()
            users_with_expo_tokens = CustomUser.objects.filter(fcm_token__startswith='ExponentPushToken').count()
            users_with_fcm_tokens = CustomUser.objects.exclude(fcm_token__isnull=True).exclude(fcm_token='').exclude(fcm_token__startswith='ExponentPushToken').count()

            stats = {
                'total_users': total_users,
                'users_with_tokens': users_with_tokens,
                'users_with_expo_tokens': users_with_expo_tokens,
                'users_with_fcm_tokens': users_with_fcm_tokens,
                'migration_progress': round((users_with_fcm_tokens / total_users * 100) if total_users > 0 else 0, 1)
            }

            logger.info(f"🔥 [FCM] 📊 TOKEN STATISTICS:")
            logger.info(f"🔥 [FCM]   Total Users: {stats['total_users']}")
            logger.info(f"🔥 [FCM]   Users with Tokens: {stats['users_with_tokens']}")
            logger.info(f"🔥 [FCM]   Users with Expo Tokens: {stats['users_with_expo_tokens']} ❌")
            logger.info(f"🔥 [FCM]   Users with FCM Tokens: {stats['users_with_fcm_tokens']} ✅")
            logger.info(f"🔥 [FCM]   Migration Progress: {stats['migration_progress']}%")

            return stats

        except Exception as e:
            logger.error(f"🔥 [FCM] Error getting token statistics: {str(e)}")
            return None