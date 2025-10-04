import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from asgiref.sync import sync_to_async
from django.contrib.auth.models import AnonymousUser
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.authtoken.models import Token
from .models import Room, Message, PrivateChatRoom, PrivateMessage
from django.db.models import Q, Count
import asyncio
from typing import Dict, List, Any

from .push_notifications import PushNotificationService

logger = logging.getLogger('chatapp.consumers')



class ChatConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.room_name = None
        self.room_group_name = None
        self.room = None
        self.user = None
        self.user_inbox = None

    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.room_name}'
        self.user = self.scope['user']

        if self.user == AnonymousUser():
            await self.close()
            return

        try:
            self.room = await self.get_room(self.room_name)
        except:
            await self.close()
            return

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        # Устанавливаем статус пользователя онлайн
        await self.set_user_online(self.user.id)
        await self.broadcast_user_status(self.user.id, 'online')

        await self.accept()

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_join',
                'user': self.user.username
            }
        )

    @database_sync_to_async
    def get_room(self, room_name):
        return Room.objects.get(name=room_name)

    async def disconnect(self, close_code):
        if self.room_group_name:
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_leave',
                    'user': self.user.username if self.user else 'Unknown'
                }
            )

            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

        # Устанавливаем статус пользователя офлайн
        if self.user:
            await self.set_user_offline(self.user.id)
            await self.broadcast_user_status(self.user.id, 'offline')

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message = data.get('message', '')
            username = data.get('username', '')

            if message and username:
                await self.save_message(username, message)

                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'chat_message',
                        'message': message,
                        'username': username,
                        'timestamp': timezone.now().isoformat()
                    }
                )
        except Exception as e:
            logger.error(f"Error in receive: {e}")

    @database_sync_to_async
    def save_message(self, username, message):
        user = get_user_model().objects.get(username=username)
        Message.objects.create(
            room=self.room,
            sender=user,
            message=message
        )

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'message': event['message'],
            'username': event['username'],
            'timestamp': event['timestamp']
        }))

    async def user_join(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_join',
            'user': event['user']
        }))

    async def user_leave(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_leave',
            'user': event['user']
        }))

    @database_sync_to_async
    def set_user_online(self, user_id):
        """Устанавливаем статус пользователя онлайн в БД"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'online'
            user.save(update_fields=['is_online'])
            logger.info(f"User {user_id} set to online in ChatConsumer")
        except Exception as e:
            logger.error(f"Error setting user {user_id} online in ChatConsumer: {e}")

    @database_sync_to_async
    def set_user_offline(self, user_id):
        """Устанавливаем статус пользователя оффлайн в БД"""
        try:
            from django.utils import timezone
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'offline'
            user.last_seen = timezone.now()
            user.save(update_fields=['is_online', 'last_seen'])
            logger.info(f"User {user_id} set to offline in ChatConsumer")
        except Exception as e:
            logger.error(f"Error setting user {user_id} offline in ChatConsumer: {e}")

    async def broadcast_user_status(self, user_id, status):
        """Отправляем обновление статуса всем заинтересованным пользователям"""
        try:
            chat_users = await self.get_chat_users(user_id)
            for chat_user_id in chat_users:
                await self.channel_layer.group_send(
                    f'notifications_{chat_user_id}',
                    {
                        'type': 'user_status_update',
                        'user_id': user_id,
                        'status': status
                    }
                )
        except Exception as e:
            logger.error(f"Error broadcasting user status: {e}")

    @database_sync_to_async
    def get_chat_users(self, user_id):
        """Получаем список пользователей, с которыми есть чаты"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            chat_users = set()

            # Чаты, где пользователь является user1
            rooms_as_user1 = PrivateChatRoom.objects.filter(user1=user).values_list('user2_id', flat=True)
            chat_users.update(rooms_as_user1)

            # Чаты, где пользователь является user2  
            rooms_as_user2 = PrivateChatRoom.objects.filter(user2=user).values_list('user1_id', flat=True)
            chat_users.update(rooms_as_user2)

            return list(chat_users)
        except Exception as e:
            logger.error(f"Error getting chat users: {e}")
            return []


class PrivateChatConsumer(AsyncWebsocketConsumer):
    # Глобальный трекинг активных пользователей (в реальном приложении используйте Redis)
    connected_users = set()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.room_name = None
        self.user = None

    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'private_{self.room_name}'

        token = None
        query_string = self.scope.get('query_string', b'').decode()
        if 'token=' in query_string:
            token = query_string.split('token=')[1]

        if token:
            try:
                token_obj = await database_sync_to_async(Token.objects.select_related('user').get)(key=token)
                self.user = token_obj.user
            except Token.DoesNotExist:
                await self.close()
                return
        else:
            self.user = self.scope.get('user')
            if isinstance(self.user, AnonymousUser):
                await self.close()
                return

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        # Добавляем пользователя в список активных
        PrivateChatConsumer.connected_users.add(self.user.id)

        # Устанавливаем статус пользователя онлайн
        await self.set_user_online(self.user.id)
        await self.broadcast_user_status(self.user.id, 'online')

        await self.accept()

        # Помечаем сообщения как прочитанные и обновляем счетчики
        messages_updated = await self.mark_messages_as_read()
        if messages_updated:
            # Отправляем обновления счетчиков уведомлений
            await self.send_notification_updates()
            # Отправляем обновления списка чатов
            await self.send_chat_list_updates()

    @database_sync_to_async
    def mark_messages_as_read(self):
        try:
            room = PrivateChatRoom.objects.get(id=int(self.room_name))
            unread_messages = PrivateMessage.objects.filter(
                room=room,
                recipient=self.user,
                read=False
            )
            unread_count = unread_messages.count()

            if unread_count > 0:
                unread_messages.update(read=True)
                logger.info(f"Marked {unread_count} messages as read for user {self.user.id} in room {self.room_name}")
                return True  # Возвращаем True, если были обновления
            return False
        except PrivateChatRoom.DoesNotExist:
            logger.error(f"Room {self.room_name} does not exist")
            return False
        except Exception as e:
            logger.error(f"Error marking messages as read: {e}")
            return False

    async def disconnect(self, close_code):
        # Удаляем пользователя из списка активных
        if hasattr(self, 'user') and self.user:
            PrivateChatConsumer.connected_users.discard(self.user.id)

            # Устанавливаем статус пользователя офлайн
            await self.set_user_offline(self.user.id)
            await self.broadcast_user_status(self.user.id, 'offline')

        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type', '')

            logger.info(f"📡 [CONSUMER] Received message type: {message_type}")

            if message_type == 'chat_message':
                await self.handle_text_message(data)
            elif message_type == 'media_message':
                await self.handle_media_message(data)
            else:
                logger.warning(f"Unknown message type: {message_type}")

        except json.JSONDecodeError:
            logger.error("Invalid JSON received")
        except Exception as e:
            logger.error(f"Error in receive: {e}")

    async def handle_text_message(self, data):
        """Обработка обычных текстовых сообщений"""
        message_content = data.get('message', '')
        user1_id = data.get('user1')
        user2_id = data.get('user2')

        # Определяем получателя (тот, кто не является отправителем)
        recipient_id = user2_id if user1_id == self.user.id else user1_id

        logger.info(f"Processing text message: sender={self.user.id}, recipient={recipient_id}, message='{message_content[:50]}'")

        if message_content and recipient_id:
            try:
                recipient = await database_sync_to_async(get_user_model().objects.get)(id=recipient_id)
                room = await self.get_or_create_room_by_users(self.user, recipient)

                message_instance = await self.save_message(
                    self.user, message_content, room, 
                    media_type='text'
                )

                if message_instance:
                    await self.broadcast_message(message_instance, recipient_id, room)

            except get_user_model().DoesNotExist:
                await self.send(text_data=json.dumps({'error': 'Recipient not found'}))
            except Exception as e:
                logger.error(f"Error processing text message: {e}")
                await self.send(text_data=json.dumps({'error': 'Failed to send message'}))

    async def handle_media_message(self, data):
        """Обработка медиа-сообщений"""
        logger.info(f"📷 [CONSUMER] Processing media message")

        message_content = data.get('message', '')
        user1_id = data.get('user1')
        user2_id = data.get('user2')
        media_type = data.get('mediaType')
        media_hash = data.get('mediaHash')
        media_filename = data.get('mediaFileName')
        media_size = data.get('mediaSize')
        media_base64 = data.get('mediaBase64')

        # Определяем получателя
        recipient_id = user2_id if user1_id == self.user.id else user1_id

        logger.info(f"📷 [CONSUMER] Media message details: type={media_type}, hash={media_hash}, size={media_size}")

        if media_type and media_hash and recipient_id:
            try:
                recipient = await database_sync_to_async(get_user_model().objects.get)(id=recipient_id)
                room = await self.get_or_create_room_by_users(self.user, recipient)

                # Сохраняем медиа-сообщение с метаданными
                message_instance = await self.save_message(
                    self.user, message_content, room,
                    media_type=media_type,
                    media_hash=media_hash,
                    media_filename=media_filename,
                    media_size=media_size
                )

                if message_instance:
                    # Отправляем сообщение включая base64 данные для получателя
                    await self.broadcast_media_message(
                        message_instance, recipient_id, room, media_base64
                    )

                logger.info(f"📷 [CONSUMER] ✅ Media message processed successfully")

            except get_user_model().DoesNotExist:
                logger.error(f"📷 [CONSUMER] ❌ Recipient not found: {recipient_id}")
                await self.send(text_data=json.dumps({'error': 'Recipient not found'}))
            except Exception as e:
                logger.error(f"📷 [CONSUMER] ❌ Error processing media message: {e}")
                await self.send(text_data=json.dumps({'error': 'Failed to send media message'}))
        else:
            logger.error(f"📷 [CONSUMER] ❌ Missing required media data")
            await self.send(text_data=json.dumps({'error': 'Missing media data'}))

    async def broadcast_message(self, message_instance, recipient_id, room):
        """Отправка обычного сообщения всем участникам"""
        timestamp = message_instance.timestamp.isoformat()

        # Отправляем сообщение в группу чата
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message_instance.message,
                'sender__username': self.user.username,
                'sender_id': self.user.id,
                'recipient_id': recipient_id,
                'timestamp': int(message_instance.timestamp.timestamp()),
                'id': message_instance.id
            }
        )

        # Отправляем уведомление получателю
        await self.channel_layer.group_send(
            f'notifications_{recipient_id}',
            {
                'type': 'new_message_notification',
                'sender_id': self.user.id,
                'sender_name': self.user.username,
                'recipient_id': recipient_id,
                'message': message_instance.message,
                'timestamp': timestamp,
                'room_id': room.id
            }
        )

        # Обновляем список чатов для обоих пользователей
        await self.notify_chat_list_update([self.user.id, recipient_id])

        # Отправляем push-уведомление
        await self.send_push_notification_if_needed(message_instance)

    async def broadcast_media_message(self, message_instance, recipient_id, room, media_base64):
        """Отправка медиа-сообщения всем участникам"""
        timestamp = message_instance.timestamp.isoformat()

        logger.info(f"📷 [CONSUMER] Broadcasting media message with hash: {message_instance.media_hash}")

        # Отправляем сообщение в группу чата с медиа-данными
        message_data = {
            'type': 'chat_message',
            'message': message_instance.message,
            'sender__username': self.user.username,
            'sender_id': self.user.id,
            'recipient_id': recipient_id,
            'timestamp': int(message_instance.timestamp.timestamp()),
            'id': message_instance.id,
            'mediaType': message_instance.media_type,
            'mediaHash': message_instance.media_hash,
            'mediaFileName': message_instance.media_filename,
            'mediaSize': message_instance.media_size
        }

        # Добавляем base64 данные если есть
        if media_base64:
            message_data['mediaBase64'] = media_base64
            logger.info(f"📷 [CONSUMER] Including base64 data in broadcast")

        await self.channel_layer.group_send(self.room_group_name, message_data)

        # Отправляем уведомление получателю
        await self.channel_layer.group_send(
            f'notifications_{recipient_id}',
            {
                'type': 'new_message_notification',
                'sender_id': self.user.id,
                'sender_name': self.user.username,
                'recipient_id': recipient_id,
                'message': message_instance.message,
                'timestamp': timestamp,
                'room_id': room.id
            }
        )

        # Обновляем список чатов для обоих пользователей
        await self.notify_chat_list_update([self.user.id, recipient_id])

        # Отправляем push-уведомление
        await self.send_push_notification_if_needed(message_instance)

    async def chat_message(self, event):
        message = event['message']
        sender = event.get('sender__username', event.get('sender', 'Unknown'))
        timestamp = event['timestamp']
        message_id = event.get('id', event.get('message_id'))
        sender_id = event.get('sender_id')

        # Медиа данные
        media_type = event.get('mediaType')
        media_hash = event.get('mediaHash')
        media_filename = event.get('mediaFileName')
        media_size = event.get('mediaSize')
        media_base64 = event.get('mediaBase64')

        if media_type:
            logger.info(f"📡 [SEND] Sending media message to client: type={media_type}, hash={media_hash}")
        else:
            logger.info(f"📡 [SEND] Sending text message to client: sender={sender}, message='{message[:50]}'")

        # Базовые данные сообщения
        response_data = {
            'message': message,
            'sender__username': sender,
            'timestamp': timestamp,
            'id': message_id,
            'sender_id': sender_id
        }

        # Добавляем медиа данные если есть
        if media_type and media_hash:
            response_data.update({
                'mediaType': media_type,
                'mediaHash': media_hash,
                'mediaFileName': media_filename,
                'mediaSize': media_size
            })

            # Добавляем base64 данные если есть
            if media_base64:
                response_data['mediaBase64'] = media_base64
                logger.info(f"📡 [SEND] Including base64 data in client response")

        await self.send(text_data=json.dumps(response_data))

    @database_sync_to_async
    def save_message(self, sender, message_content, room, media_type='text', 
                    media_hash=None, media_filename=None, media_size=None):
        try:
            from media_api.models import UploadedFile

            recipient = room.user2 if room.user1 == sender else room.user1

            logger.info(f"💾 [DB] Saving message: type={media_type}, hash={media_hash}")

            # Ищем медиафайл по hash если это медиа-сообщение
            media_file = None
            if media_type in ['image', 'video'] and media_hash:
                try:
                    # Поиск файла по hash и отправителю
                    media_file = UploadedFile.objects.filter(
                        user=sender,
                        file_type=media_type
                    ).order_by('-uploaded_at').first()

                    if media_file:
                        logger.info(f"💾 [DB] Found media_file: {media_file.id} for hash {media_hash}")
                    else:
                        logger.warning(f"💾 [DB] Media file not found for hash {media_hash}")
                except Exception as file_error:
                    logger.error(f"💾 [DB] Error finding media file: {file_error}")

            message = PrivateMessage.objects.create(
                room=room,
                sender=sender,
                recipient=recipient,
                message=message_content,
                timestamp=timezone.now(),
                media_type=media_type,
                media_hash=media_hash,
                media_filename=media_filename,
                media_size=media_size,
                media_file=media_file
            )

            logger.info(f"💾 [DB] ✅ Message saved with ID: {message.id}, media_file: {media_file.id if media_file else None}")
            return message
        except Exception as e:
            logger.error(f"💾 [DB] ❌ Error saving message: {e}")
            return None

    @database_sync_to_async
    def notify_chat_list_update(self, user_ids):
        pass

    @database_sync_to_async
    def get_or_create_room_by_users(self, user1, user2):
        try:
            room = PrivateChatRoom.objects.filter(
                Q(user1=user1, user2=user2) | Q(user1=user2, user2=user1)
            ).first()

            if not room:
                room = PrivateChatRoom.objects.create(user1=user1, user2=user2)

            return room
        except Exception as e:
            logger.error(f"Error getting/creating room: {e}")
            raise

    @database_sync_to_async
    def set_user_online(self, user_id):
        """Устанавливаем статус пользователя онлайн в БД"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'online'
            user.save(update_fields=['is_online'])
            logger.info(f"User {user_id} set to online in PrivateChatConsumer")
        except Exception as e:
            logger.error(f"Error setting user {user_id} online in PrivateChatConsumer: {e}")

    @database_sync_to_async
    def set_user_offline(self, user_id):
        """Устанавливаем статус пользователя оффлайн в БД"""
        try:
            from django.utils import timezone
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'offline'
            user.last_seen = timezone.now()
            user.save(update_fields=['is_online', 'last_seen'])
            logger.info(f"User {user_id} set to offline in PrivateChatConsumer")
        except Exception as e:
            logger.error(f"Error setting user {user_id} offline in PrivateChatConsumer: {e}")

    async def broadcast_user_status(self, user_id, status):
        """Отправляем обновление статуса всем заинтересованным пользователям"""
        try:
            chat_users = await self.get_chat_users_for_status(user_id)
            for chat_user_id in chat_users:
                await self.channel_layer.group_send(
                    f'notifications_{chat_user_id}',
                    {
                        'type': 'user_status_update',
                        'user_id': user_id,
                        'status': status
                    }
                )
        except Exception as e:
            logger.error(f"Error broadcasting user status: {e}")

    @database_sync_to_async
    def get_chat_users_for_status(self, user_id):
        """Получаем список пользователей, с которыми есть чаты"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            chat_users = set()

            # Чаты, где пользователь является user1
            rooms_as_user1 = PrivateChatRoom.objects.filter(user1=user).values_list('user2_id', flat=True)
            chat_users.update(rooms_as_user1)

            # Чаты, где пользователь является user2  
            rooms_as_user2 = PrivateChatRoom.objects.filter(user2=user).values_list('user1_id', flat=True)
            chat_users.update(rooms_as_user2)

            return list(chat_users)
        except Exception as e:
            logger.error(f"Error getting chat users for status: {e}")
            return []

    async def send_notification_updates(self):
        """Отправляем обновления счетчиков уведомлений"""
        try:
            # Отправляем триггер для обновления уведомлений текущему пользователю
            await self.channel_layer.group_send(
                f'notifications_{self.user.id}',
                {
                    'type': 'new_message_notification',
                    'sender_id': self.user.id,
                    'trigger_update': True  # Флаг для принудительного обновления
                }
            )
            logger.info(f"Sent notification update trigger for user {self.user.id}")
        except Exception as e:
            logger.error(f"Error sending notification updates: {e}")

    async def send_chat_list_updates(self):
        """Отправляем обновления списка чатов"""
        try:
            # Получаем обновленный список чатов
            chat_data = await self.get_user_chats_for_update(self.user.id)

            # Отправляем обновление списка чатов текущему пользователю через ChatListConsumer
            await self.channel_layer.group_send(
                f'chat_list_{self.user.id}',
                {
                    'type': 'chat_list_update',
                    'chat_data': chat_data
                }
            )
            logger.info(f"Sent chat list update for user {self.user.id}")
        except Exception as e:
            logger.error(f"Error sending chat list updates: {e}")

    @database_sync_to_async
    def get_user_chats_for_update(self, user_id):
        """Получаем обновленный список чатов пользователя"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            # Получаем все чаты пользователя
            rooms = PrivateChatRoom.objects.filter(
                Q(user1=user) | Q(user2=user)
            ).select_related('user1', 'user2')

            chat_data = []
            for room in rooms:
                # Определяем собеседника
                other_user = room.user2 if room.user1 == user else room.user1

                # Получаем последнее сообщение
                last_message = PrivateMessage.objects.filter(
                    room=room
                ).order_by('-timestamp').first()

                if last_message:  # Показываем только чаты с сообщениями
                    # Считаем непрочитанные сообщения
                    unread_count = PrivateMessage.objects.filter(
                        room=room,
                        recipient=user,
                        read=False
                    ).count()

                    chat_info = {
                        'id': room.id,
                        'other_user': {
                            'id': other_user.id,
                            'username': other_user.username,
                            'first_name': getattr(other_user, 'first_name', ''),
                            'last_name': getattr(other_user, 'last_name', ''),
                            'avatar': other_user.avatar.url if hasattr(other_user,
                                                                       'avatar') and other_user.avatar else None,
                            'gender': getattr(other_user, 'gender', 'male'),
                            'is_online': getattr(other_user, 'is_online', 'offline')
                        },
                        'last_message': last_message.message,
                        'last_message_time': last_message.timestamp.isoformat(),
                        'unread_count': unread_count
                    }
                    chat_data.append(chat_info)

            # Сортируем по времени последнего сообщения
            chat_data.sort(key=lambda x: x['last_message_time'], reverse=True)
            return chat_data

        except Exception as e:
            logger.error(f"Error getting user chats for update: {e}")
            return []

    async def send_push_notification_if_needed(self, message_instance):
        """
        Отправляем push-уведомление если нужно
        """
        logger.info(f"🔥 [PUSH] === CHECKING PUSH NOTIFICATION NEEDED ===")
        logger.info(f"🔥 [PUSH] Message ID: {message_instance.id}")
        logger.info(f"🔥 [PUSH] Sender: {message_instance.sender.username} (ID: {message_instance.sender.id})")
        logger.info(f"🔥 [PUSH] Message: {message_instance.message[:50]}...")

        try:
            # Получаем получателя сообщения
            recipient = None
            if hasattr(message_instance, 'recipient'):
                recipient = message_instance.recipient
                logger.info(f"🔥 [PUSH] Recipient from message.recipient: {recipient}")
            else:
                # Определяем получателя из участников комнаты (исключая отправителя)
                room_users = message_instance.room.participants.exclude(id=message_instance.sender.id)
                recipient = room_users.first() if room_users.exists() else None
                logger.info(f"🔥 [PUSH] Room participants (excluding sender): {room_users.count()}")
                if recipient:
                    logger.info(f"🔥 [PUSH] Selected recipient: {recipient.username} (ID: {recipient.id})")

            if not recipient:
                logger.error(f"🔥 [PUSH] ❌ No recipient found for message {message_instance.id}")
                return

            logger.info(f"🔥 [PUSH] ✅ Recipient determined: {recipient.username} (ID: {recipient.id})")

            # Проверяем, онлайн ли получатель
            recipient_online = self.is_user_online(recipient.id)
            logger.info(f"🔥 [PUSH] Recipient {recipient.username} online status: {recipient_online}")

            # КРИТИЧНО: Отправляем push уведомления НЕЗАВИСИМО от онлайн статуса для отладки
            logger.info(f"🔥 [PUSH] === FORCING PUSH NOTIFICATION SEND FOR DEBUG ===")
            logger.info(f"🔥 [PUSH] Normal logic would be: send only if offline ({not recipient_online})")
            logger.info(f"🔥 [PUSH] DEBUG: Sending push notification regardless of online status")

            # Отправляем push-уведомление асинхронно
            try:
                await sync_to_async(self._send_push_notification_sync)(message_instance, recipient)
                logger.info(f"🔥 [PUSH] ✅ Push notification send attempt completed")
            except Exception as send_error:
                logger.error(f"🔥 [PUSH] ❌ Push notification send failed: {send_error}")
                logger.error(f"🔥 [PUSH] ❌ Send error details: {str(send_error)}")

        except Exception as e:
            logger.error(f"🔥 [PUSH] ❌ Critical error in push notification logic: {e}")
            logger.error(f"🔥 [PUSH] ❌ Error type: {type(e).__name__}")
            logger.error(f"🔥 [PUSH] ❌ Error details: {str(e)}")

    def _send_push_notification_sync(self, message_instance, recipient):
        """
        Синхронная версия отправки push-уведомления
        """
        logger.info(f"🔥 [PUSH-SYNC] === SENDING PUSH NOTIFICATION ===")
        logger.info(f"🔥 [PUSH-SYNC] Target user: {recipient.username} (ID: {recipient.id})")
        logger.info(f"🔥 [PUSH-SYNC] Message: {message_instance.message}")
        logger.info(f"🔥 [PUSH-SYNC] Sender: {message_instance.sender.username}")
        logger.info(f"🔥 [PUSH-SYNC] Chat ID: {message_instance.room.id}")

        # Получаем push токены получателя
        logger.info(f"🔥 [PUSH-SYNC] Initializing PushNotificationService...")
        push_service = PushNotificationService()

        try:
            logger.info(f"🔥 [PUSH-SYNC] Calling send_message_notification with:")
            logger.info(f"🔥 [PUSH-SYNC]   recipient_id: {recipient.id}")
            logger.info(f"🔥 [PUSH-SYNC]   sender_name: {message_instance.sender.username}")
            logger.info(f"🔥 [PUSH-SYNC]   message: {message_instance.message[:100]}...")
            logger.info(f"🔥 [PUSH-SYNC]   chat_id: {message_instance.room.id}")
            logger.info(f"🔥 [PUSH-SYNC]   sender_id: {message_instance.sender.id}")

            # Сначала получаем FCM токены получателя из базы данных
            logger.info(f"🔥 [PUSH-SYNC] Getting FCM tokens for user {recipient.id}")

            # Получаем FCM токены получателя
            fcm_tokens = []
            if hasattr(recipient, 'fcm_token') and recipient.fcm_token:
                fcm_tokens.append(recipient.fcm_token)
                logger.info(f"🔥 [PUSH-SYNC] Found FCM token: {recipient.fcm_token[:20]}...")
            else:
                logger.warning(f"🔥 [PUSH-SYNC] ❌ No FCM token found for user {recipient.username}")
                return

            logger.info(f"🔥 [PUSH-SYNC] Total FCM tokens to send to: {len(fcm_tokens)}")

            # Отправляем уведомление с правильными параметрами
            result = push_service.send_message_notification(
                fcm_tokens=fcm_tokens,
                sender_name=message_instance.sender.username,
                message_text=message_instance.message,
                chat_id=message_instance.room.id
            )

            logger.info(f"🔥 [PUSH-SYNC] ✅ Push notification service returned: {result}")
            logger.info(f"🔥 [PUSH-SYNC] ✅ Push notification for {recipient.username} sent successfully")

        except Exception as e:
            logger.error(f"🔥 [PUSH-SYNC] ❌ Error sending push notification for {recipient.username}: {e}")
            logger.error(f"🔥 [PUSH-SYNC] ❌ Error type: {type(e).__name__}")
            logger.error(f"🔥 [PUSH-SYNC] ❌ Error details: {str(e)}")
            import traceback
            logger.error(f"🔥 [PUSH-SYNC] ❌ Traceback: {traceback.format_exc()}")

    async def is_user_online(self, user_id):
        """
        Проверяем, подключен ли пользователь к WebSocket
        """
        try:
            # Проверяем через channel layer, есть ли активные соединения
            # для этого пользователя в группе уведомлений
            group_name = f'notifications_{user_id}'

            # Простая проверка - если пользователь в нашем локальном списке
            # (это работает только для одного воркера, для продакшена нужен Redis)
            is_online = user_id in PrivateChatConsumer.connected_users

            logger.debug(f"User {user_id} online status: {is_online}")
            return is_online

        except Exception as e:
            logger.error(f"Error checking user online status: {e}")
            return False  # По умолчанию считаем offline для отправки push


class NotificationConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user_id = None
        self.notification_group_name = None
        # Кеш для предотвращения дублирования уведомлений
        self.previous_messages_cache = {}

    async def connect(self):
        await self.accept()

        # Получаем пользователя из токена
        token = None
        query_string = self.scope.get('query_string', b'').decode()
        if 'token=' in query_string:
            token = query_string.split('token=')[1].split('&')[0]

        if token:
            try:
                token_obj = await database_sync_to_async(Token.objects.select_related('user').get)(key=token)
                self.user_id = token_obj.user.id

                # Подписываемся на группу уведомлений пользователя
                self.notification_group_name = f'notifications_{self.user_id}'
                await self.channel_layer.group_add(
                    self.notification_group_name,
                    self.channel_name
                )

                logger.info(f"User {self.user_id} connected to notifications")

                # НОВОЕ: Отправляем статус "онлайн" и уведомляем других пользователей
                await self.set_user_online(self.user_id)
                await self.broadcast_user_status(self.user_id, 'online')

                # Отправляем начальные уведомления
                unread_sender_count = await self.get_unique_senders_count(self.user_id)
                messages_by_sender = await self.get_messages_by_sender(self.user_id)
                await self.send_initial_notification(unread_sender_count, messages_by_sender)

            except Token.DoesNotExist:
                await self.close()

    async def send_notification_update(self, unique_sender_count, messages_by_sender):
        try:
            # НОВОЕ: проверяем, изменились ли данные
            current_messages_hash = hash(str(messages_by_sender))
            previous_hash = self.previous_messages_cache.get('hash')

            if previous_hash == current_messages_hash:
                logger.debug(f"No changes in messages for user {self.user_id}, skipping update")
                return

            # Обновляем кеш
            self.previous_messages_cache['hash'] = current_messages_hash
            self.previous_messages_cache['messages'] = messages_by_sender

            formatted_messages = []
            for message in messages_by_sender:
                user_info = await self.get_user_info(message['sender_id'])
                formatted_message = {
                    'sender_id': message['sender_id'],
                    'sender_name': user_info.get('username', f"Пользователь {message['sender_id']}"),
                    'count': message['count'],
                    'last_message': message.get('last_message', ''),
                    'timestamp': message.get('timestamp'),
                    'message_id': message.get('message_id'),  # ДОБАВЛЕНО: ID сообщения
                    'chat_id': message.get('chat_id')
                }
                formatted_messages.append(formatted_message)

            await self.send(text_data=json.dumps({
                'type': 'notification_update',
                'unique_sender_count': unique_sender_count,
                'messages': [{'user': self.user_id}, formatted_messages]
            }))

            logger.debug(f"Sent notification update to user {self.user_id}")

        except Exception as e:
            logger.error(f"Error in send_notification_update: {e}")

    async def send_initial_notification(self, unique_sender_count, messages_by_sender):
        try:
            formatted_messages = []
            for message in messages_by_sender:
                user_info = await self.get_user_info(message['sender_id'])
                formatted_message = {
                    'sender_id': message['sender_id'],
                    'sender_name': user_info.get('username', f"Пользователь {message['sender_id']}"),
                    'count': message['count'],
                    'last_message': message.get('last_message', ''),
                    'timestamp': message.get('timestamp'),
                    'message_id': message.get('message_id'),  # ДОБАВЛЕНО: ID сообщения
                    'chat_id': message.get('chat_id')
                }
                formatted_messages.append(formatted_message)

            await self.send(text_data=json.dumps({
                'type': 'initial_notification',
                'unique_sender_count': unique_sender_count,
                'messages': [{'user': self.user_id}, formatted_messages]
            }))

            # Инициализируем кеш
            self.previous_messages_cache['hash'] = hash(str(messages_by_sender))
            self.previous_messages_cache['messages'] = messages_by_sender

        except Exception as e:
            logger.error(f"Error in send_initial_notification: {e}")

    async def new_message_notification(self, event):
        """
        ОБНОВЛЕНО: Обработчик для новых уведомлений о сообщениях
        """
        try:
            logger.info(f"Processing new message notification for user {self.user_id}")

            # Если это принудительное обновление (например, после прочтения сообщений)
            if event.get('trigger_update'):
                # Сбрасываем кеш для принудительного обновления
                self.previous_messages_cache = {}
                logger.info(f"Forced notification update triggered for user {self.user_id}")

            # Получаем обновленные данные
            unread_sender_count = await self.get_unique_senders_count(self.user_id)
            messages_by_sender = await self.get_messages_by_sender(self.user_id)

            # Отправляем обновленные уведомления (с проверкой дублирования)
            await self.send_notification_update(unread_sender_count, messages_by_sender)

        except Exception as e:
            logger.error(f"Error sending new message notification: {e}")

    # Остальные методы остаются без изменений...
    async def separate_message_notification(self):
        try:
            all_messages = await self.get_messages_by_sender(self.user_id)
            total_unique_senders = len(all_messages)

            notifications_data = []
            for message in all_messages:
                user_info = await self.get_user_info(message['sender_id'])
                notification_data = {
                    'sender_id': message['sender_id'],
                    'sender_name': user_info.get('username', f"Пользователь {message['sender_id']}"),
                    'count': message['count'],
                    'last_message': message.get('last_message', 'Новое сообщение'),
                    'timestamp': message.get('timestamp'),
                    'chat_id': message.get('chat_id')
                }
                notifications_data.append(notification_data)

            await self.send(text_data=json.dumps({
                'type': 'separate_notifications',
                'unique_sender_count': total_unique_senders,
                'notifications': notifications_data
            }))

        except Exception as e:
            logger.error(f"Error in separate_message_notification: {e}")

    async def direct_message_notification(self, message_data):
        try:
            await self.send(text_data=json.dumps({
                'type': 'direct_message_notification',
                'message_data': message_data
            }))
        except Exception as e:
            logger.error(f"Error in direct_message_notification: {e}")

    async def notification_message(self, event):
        try:
            message_type = event.get('message_type', 'notification')

            if message_type == 'message_notification':
                unread_sender_count = await self.get_unique_senders_count(self.user_id)
                messages_by_sender = await self.get_messages_by_sender(self.user_id)

                await self.send_notification_update(unread_sender_count, messages_by_sender)

        except Exception as e:
            logger.error(f"Error in notification_message: {e}")

    @database_sync_to_async
    def get_user_info(self, user_id):
        try:
            user = get_user_model().objects.get(id=user_id)
            return {
                'id': user.id,
                'username': user.username,
                'first_name': getattr(user, 'first_name', ''),
                'last_name': getattr(user, 'last_name', ''),
            }
        except:
            return {'id': user_id, 'username': f'User {user_id}'}

    async def send_user_online(self, user_id):
        await self.channel_layer.group_send(
            f'user_status_{user_id}',
            {
                'type': 'user_status_update',
                'user_id': user_id,
                'status': 'online'
            }
        )

    async def send_user_offline(self, user_id):
        await self.channel_layer.group_send(
            f'user_status_{user_id}',
            {
                'type': 'user_status_update',
                'user_id': user_id,
                'status': 'offline'
            }
        )

    async def broadcast_user_status(self, user_id, status):
        # Найти все чаты пользователя и отправить обновление статуса
        chat_users = await self.get_chat_users(user_id)
        for chat_user_id in chat_users:
            await self.channel_layer.group_send(
                f'notifications_{chat_user_id}',
                {
                    'type': 'user_status_update',
                    'user_id': user_id,
                    'status': status
                }
            )

    async def disconnect(self, close_code):
        # Отписываемся от группы уведомлений
        if hasattr(self, 'notification_group_name') and self.notification_group_name:
            await self.channel_layer.group_discard(
                self.notification_group_name,
                self.channel_name
            )
            logger.info(f"User {self.user_id} disconnected from notifications")

        if self.user_id:
            # ИСПРАВЛЕНО: Устанавливаем статус "оффлайн" и уведомляем других
            await self.set_user_offline(self.user_id)
            await self.broadcast_user_status(self.user_id, 'offline')

    @database_sync_to_async
    def set_user_online(self, user_id):
        """Устанавливаем статус пользователя онлайн в БД"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'online'
            user.save(update_fields=['is_online'])
            logger.info(f"User {user_id} set to online")
        except Exception as e:
            logger.error(f"Error setting user {user_id} online: {e}")

    @database_sync_to_async
    def set_user_offline(self, user_id):
        """Устанавливаем статус пользователя оффлайн в БД"""
        try:
            from django.utils import timezone
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'offline'
            user.last_seen = timezone.now()
            user.save(update_fields=['is_online', 'last_seen'])
            logger.info(f"User {user_id} set to offline")
        except Exception as e:
            logger.error(f"Error setting user {user_id} offline: {e}")

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type', '')

            logger.info(f"NotificationConsumer received: {message_type} from user {self.user_id}")

            if message_type == 'ping':
                logger.info(f"Sending pong to user {self.user_id}")
                await self.send(text_data=json.dumps({'type': 'pong'}))
            elif message_type == 'get_initial_data':
                logger.info(f"Sending initial notification data to user {self.user_id}")
                unread_sender_count = await self.get_unique_senders_count(self.user_id)
                messages_by_sender = await self.get_messages_by_sender(self.user_id)
                await self.send_initial_notification(unread_sender_count, messages_by_sender)

        except Exception as e:
            logger.error(f"Error in NotificationConsumer receive: {e}")

    async def notification(self, event):
        try:
            await self.send(text_data=json.dumps({
                'type': 'notification',
                'message': event['message'],
                'user_id': event.get('user_id'),
                'notification_type': event.get('notification_type', 'general')
            }))
        except Exception as e:
            logger.error(f"Error sending notification: {e}")

    async def user_status_update(self, event):
        try:
            await self.send(text_data=json.dumps({
                'type': 'user_status_update',
                'user_id': event['user_id'],
                'status': event['status']
            }))
        except Exception as e:
            logger.error(f"Error sending user status update: {e}")

    @database_sync_to_async
    def get_unique_senders_count(self, user_id):
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            unique_senders = PrivateMessage.objects.filter(
                recipient=user,
                read=False
            ).values('sender').distinct().count()

            return unique_senders
        except Exception as e:
            logger.error(f"Error getting unique senders count: {e}")
            return 0

    @database_sync_to_async
    def get_sender_message_count(self, user_id, sender_id):
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)
            sender = User.objects.get(id=sender_id)

            count = PrivateMessage.objects.filter(
                recipient=user,
                sender=sender,
                read=False
            ).count()

            return count
        except Exception as e:
            logger.error(f"Error getting sender message count: {e}")
            return 0

    @database_sync_to_async
    def get_messages_by_sender(self, user_id):
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            # Получаем непрочитанные сообщения, сгруппированные по отправителям
            unread_messages = PrivateMessage.objects.filter(
                recipient=user,
                read=False
            ).select_related('sender', 'room').order_by('sender', '-timestamp')

            # Группируем по отправителям
            senders_data = {}
            for message in unread_messages:
                sender_id = message.sender.id
                if sender_id not in senders_data:
                    senders_data[sender_id] = {
                        'sender_id': sender_id,
                        'count': 0,
                        'last_message': message.message,
                        'timestamp': message.timestamp.timestamp(),  # ИСПРАВЛЕНО: Unix timestamp
                        'message_id': message.id,  # ДОБАВЛЕНО: ID сообщения
                        'chat_id': message.room.id if message.room else None
                    }
                senders_data[sender_id]['count'] += 1

                # ИСПРАВЛЕНО: Обновляем на самое новое сообщение
                if message.timestamp.timestamp() > senders_data[sender_id]['timestamp']:
                    senders_data[sender_id]['last_message'] = message.message
                    senders_data[sender_id]['timestamp'] = message.timestamp.timestamp()
                    senders_data[sender_id]['message_id'] = message.id

            return list(senders_data.values())

        except Exception as e:
            logger.error(f"Error getting messages by sender: {e}")
            return []

    @database_sync_to_async
    def get_chat_users(self, user_id):
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            # Получаем всех пользователей, с которыми есть чаты
            chat_users = set()

            # Чаты, где пользователь является user1
            rooms_as_user1 = PrivateChatRoom.objects.filter(user1=user).values_list('user2_id', flat=True)
            chat_users.update(rooms_as_user1)

            # Чаты, где пользователь является user2  
            rooms_as_user2 = PrivateChatRoom.objects.filter(user2=user).values_list('user1_id', flat=True)
            chat_users.update(rooms_as_user2)

            return list(chat_users)
        except Exception as e:
            logger.error(f"Error getting chat users: {e}")
            return []


class ChatListConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = None
        self.user_id = None

    async def connect(self):
        token = None
        query_string = self.scope.get('query_string', b'').decode()
        if 'token=' in query_string:
            token = query_string.split('token=')[1].split('&')[0]

        if token:
            try:
                token_obj = await database_sync_to_async(Token.objects.select_related('user').get)(key=token)
                self.user = token_obj.user
                self.user_id = token_obj.user.id

                # Подписываемся на группу обновлений списка чатов
                await self.channel_layer.group_add(
                    f'chat_list_{self.user_id}',
                    self.channel_name
                )

                # Устанавливаем статус пользователя онлайн
                await self.set_user_online(self.user_id)
                await self.broadcast_user_status(self.user_id, 'online')

                await self.accept()
            except Token.DoesNotExist:
                await self.close()
        else:
            await self.close()

    async def disconnect(self, close_code):
        # Отписываемся от группы обновлений списка чатов
        if self.user_id:
            await self.channel_layer.group_discard(
                f'chat_list_{self.user_id}',
                self.channel_name
            )

            # Устанавливаем статус пользователя офлайн
            await self.set_user_offline(self.user_id)
            await self.broadcast_user_status(self.user_id, 'offline')

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            message_type = data.get('type')

            if message_type == 'get_chat_list':
                await self.send_chat_list()

        except Exception as e:
            logger.error(f"Error in ChatListConsumer receive: {e}")

    async def send_chat_list(self):
        try:
            chats = await self.get_user_chats(self.user_id)
            await self.send(text_data=json.dumps({
                'type': 'chat_list',
                'chats': chats
            }))
        except Exception as e:
            logger.error(f"Error sending chat list: {e}")

    async def chat_list_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_list_update',
            'chat_data': event['chat_data']
        }))

    @database_sync_to_async
    def get_user_chats(self, user_id):
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            # Получаем все чаты пользователя
            rooms = PrivateChatRoom.objects.filter(
                Q(user1=user) | Q(user2=user)
            ).select_related('user1', 'user2')

            chat_data = []
            for room in rooms:
                # Определяем собеседника
                other_user = room.user2 if room.user1 == user else room.user1

                # Получаем последнее сообщение
                last_message = PrivateMessage.objects.filter(
                    room=room
                ).order_by('-timestamp').first()

                if last_message:  # Показываем только чаты с сообщениями
                    # Считаем непрочитанные сообщения
                    unread_count = PrivateMessage.objects.filter(
                        room=room,
                        recipient=user,
                        read=False
                    ).count()

                    chat_info = {
                        'id': room.id,
                        'other_user': {
                            'id': other_user.id,
                            'username': other_user.username,
                            'first_name': getattr(other_user, 'first_name', ''),
                            'last_name': getattr(other_user, 'last_name', ''),
                            'avatar': other_user.avatar.url if hasattr(other_user,
                                                                       'avatar') and other_user.avatar else None,
                            'gender': getattr(other_user, 'gender', 'male'),
                            'is_online': getattr(other_user, 'is_online', 'offline')
                        },
                        'last_message': last_message.message,
                        'last_message_time': last_message.timestamp.isoformat(),
                        'unread_count': unread_count
                    }
                    chat_data.append(chat_info)

            # Сортируем по времени последнего сообщения
            chat_data.sort(key=lambda x: x['last_message_time'], reverse=True)
            return chat_data

        except Exception as e:
            logger.error(f"Error getting user chats: {e}")
            return []

    @database_sync_to_async
    def set_user_online(self, user_id):
        """Устанавливаем статус пользователя онлайн в БД"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'online'
            user.save(update_fields=['is_online'])
            logger.info(f"User {user_id} set to online in ChatListConsumer")
        except Exception as e:
            logger.error(f"Error setting user {user_id} online in ChatListConsumer: {e}")

    @database_sync_to_async
    def set_user_offline(self, user_id):
        """Устанавливаем статус пользователя оффлайн в БД"""
        try:
            from django.utils import timezone
            User = get_user_model()
            user = User.objects.get(id=user_id)
            user.is_online = 'offline'
            user.last_seen = timezone.now()
            user.save(update_fields=['is_online', 'last_seen'])
            logger.info(f"User {user_id} set to offline in ChatListConsumer")
        except Exception as e:
            logger.error(f"Error setting user {user_id} offline in ChatListConsumer: {e}")

    async def broadcast_user_status(self, user_id, status):
        """Отправляем обновление статуса всем заинтересованным пользователям"""
        try:
            chat_users = await self.get_chat_users_for_broadcast(user_id)
            for chat_user_id in chat_users:
                await self.channel_layer.group_send(
                    f'notifications_{chat_user_id}',
                    {
                        'type': 'user_status_update',
                        'user_id': user_id,
                        'status': status
                    }
                )
        except Exception as e:
            logger.error(f"Error broadcasting user status from ChatListConsumer: {e}")

    @database_sync_to_async
    def get_chat_users_for_broadcast(self, user_id):
        """Получаем список пользователей, с которыми есть чаты"""
        try:
            User = get_user_model()
            user = User.objects.get(id=user_id)

            chat_users = set()

            # Чаты, где пользователь является user1
            rooms_as_user1 = PrivateChatRoom.objects.filter(user1=user).values_list('user2_id', flat=True)
            chat_users.update(rooms_as_user1)

            # Чаты, где пользователь является user2  
            rooms_as_user2 = PrivateChatRoom.objects.filter(user2=user).values_list('user1_id', flat=True)
            chat_users.update(rooms_as_user2)

            return list(chat_users)
        except Exception as e:
            logger.error(f"Error getting chat users for broadcast: {e}")
            return []
