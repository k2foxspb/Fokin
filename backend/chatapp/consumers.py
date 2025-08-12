import asyncio
import json
import time
from datetime import datetime
import logging

from asgiref.sync import async_to_sync, sync_to_async
from channels.db import database_sync_to_async
from channels.generic.websocket import WebsocketConsumer, AsyncWebsocketConsumer
from channels.layers import get_channel_layer
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Q, Count, Max

from authapp.models import CustomUser
from .models import Room, PrivateChatRoom, PrivateMessage, Message
from .push_notifications import PushNotificationService
from .telegram import send_message

logger = logging.getLogger(__name__)


class ChatConsumer(WebsocketConsumer):

    def __init__(self, *args, **kwargs):
        super().__init__(args, kwargs)
        self.room_name = None
        self.room_group_name = None
        self.room = None
        self.user = None
        self.user_inbox = None

    def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f'chat_{self.room_name}'
        self.room = Room.objects.get(name=self.room_name)
        self.user = self.scope['user']
        self.user_inbox = f'inbox_{self.user.username}'

        # connection has to be accepted
        self.accept()

        # join the room group
        async_to_sync(self.channel_layer.group_add)(
            self.room_group_name,
            self.channel_name,
        )

        # send the user list to the newly joined user
        self.send(json.dumps({
            'type': 'user_list',
            'users': [user.username for user in self.room.online.all()]
        }))

        if self.user.is_authenticated and self.user not in self.room.online.all():
            # create a user inbox for private messages
            async_to_sync(self.channel_layer.group_add)(
                self.user_inbox,
                self.channel_name,
            )

            # send the join event to the room
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'user_join',
                    'user': self.user.username,
                }
            )
            self.room.join(self.user)

    def disconnect(self, close_code):
        async_to_sync(self.channel_layer.group_discard)(
            self.room_group_name,
            self.channel_name,
        )

        if self.user.is_authenticated:
            # delete the user inbox for private messages
            async_to_sync(self.channel_layer.group_discard)(
                self.user_inbox,
                self.channel_name,
            )

            # send the leave event to the room
            async_to_sync(self.channel_layer.group_send)(
                self.room_group_name,
                {
                    'type': 'user_leave',
                    'user': self.user.username,
                }
            )
            self.room.leave(self.user)

    def receive(self, text_data=None, bytes_data=None):
        text_data_json = json.loads(text_data)
        message = text_data_json['message']

        if not self.user.is_authenticated:
            return

        async_to_sync(self.channel_layer.group_send)(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'user': self.user.username,
                'timestamp': datetime.now().astimezone().strftime('%d.%m.%Y, %H:%M:%S'),
            }
        )

        Message.objects.create(user=self.user, room=self.room, content=message)
        # send_message(
        #     f'name: {self.user}\n'
        #     f'room: {self.room}\n'
        #     f'msg: {message}'
        # )

    def chat_message(self, event):
        self.send(text_data=json.dumps(event))

    def user_join(self, event):
        self.send(text_data=json.dumps(event))

    def user_leave(self, event):
        self.send(text_data=json.dumps(event))


class PrivateChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.user = self.scope['user']

        if not self.user.is_authenticated:
            await self.close()
            return

        await self.channel_layer.group_add(self.room_name, self.channel_name)
        updated_count = await self.mark_messages_as_read(self.user, self.room_name)

        await self.accept()
        if updated_count > 0:
            channel_layer = get_channel_layer()
            await channel_layer.group_send(
                f"user_{self.user.id}",
                {
                    "type": "notification",
                    "user_id": self.user.id,
                },
            )
            print(f"🔔 [DEBUG] Sent notification update after marking {updated_count} messages as read")

    @sync_to_async
    def mark_messages_as_read(self, user, room_name):
        try:
            room = PrivateChatRoom.objects.get(id=int(room_name))
            if room:
                # Получаем количество сообщений до обновления
                unread_count_before = PrivateMessage.objects.filter(
                    room_id=room.id,
                    recipient=user,
                    read=False
                ).exclude(sender=user).count()

                # Помечаем как прочитанные
                updated_count = PrivateMessage.objects.filter(
                    room_id=room.id,
                    recipient=user,
                    read=False
                ).exclude(sender=user).update(read=True)

                print(f"📖 [DEBUG] Marked {updated_count} messages as read in room {room_name} for user {user.id}")
                print(f"📖 [DEBUG] Before: {unread_count_before}, After update: {updated_count}")

                return updated_count
        except PrivateChatRoom.DoesNotExist:
            print(f"❌ [DEBUG] Room {room_name} not found")
            return 0
        except Exception as e:
            print(f"❌ [DEBUG] Error in mark_messages_as_read: {e}")
            return 0

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_name, self.channel_name)

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message = text_data_json['message']
            timestamp = int(text_data_json['timestamp'])
            user1_id = int(text_data_json['user1'])
            user2_id = int(text_data_json['user2'])

            new_message = await self.save_message(user1_id, user2_id, message, timestamp, self.user)
            recipient = user2_id if self.user.id != user2_id else user1_id

            if new_message:
                # Отправляем данные в WebSocket
                message_data = {
                    'type': 'chat_message',
                    'message': message,
                    'sender__username': self.user.username,  # Используем email вместо username
                    'sender_id': self.user.id,  # Добавляем sender_id для надежности
                    'recipient__id': recipient,
                    'timestamp': timestamp,
                    'id': new_message.id
                }

                await self.channel_layer.group_send(
                    self.room_name,
                    message_data
                )
                await self.notify_chat_list_update(user1_id, user2_id)


            else:
                logger.error("Failed to save message.")
                await self.send(text_data=json.dumps({'error': 'Failed to save message.'}))

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.error(f"Error processing message from user {self.user}: {e}, data: {text_data}")
        except Exception as e:
            logger.exception(f"Error in receive from user {self.user}: {e}")

    async def chat_message(self, event):
        print(f"=== CHAT_MESSAGE DEBUG ===")
        print(f"event: {event}")

        message_data = {
            'message': event['message'],
            'sender__username': event['sender__username'],
            'sender_id': event.get('sender_id'),  # Добавляем sender_id
            'timestamp': event['timestamp'],
            'id': event['id']
        }

        print(f"Sending to client: {message_data}")

        # Отправляем сообщение в WebSocket-соединение чата
        await self.send(text_data=json.dumps(message_data))

        # Вместо отправки индивидуального уведомления, мы просто запрашиваем обновление всех уведомлений
        # через стандартный обработчик notification
        try:
            # Добавляем задержку перед отправкой уведомления
            # (чтобы избежать гонки условий)
            await asyncio.sleep(0.1)

            channel_layer = get_channel_layer()
            # Отправляем специальное уведомление для отдельного сообщения
            await channel_layer.group_send(
                f"user_{event['recipient__id']}",
                {
                    # Используем отдельный тип для индивидуальных уведомлений
                    "type": "separate_message_notification",
                    "sender_id": event.get('sender_id'),
                    "sender_name": event['sender__username'],
                    "message": event['message'],
                    "timestamp": event['timestamp'],
                    "message_id": event['id'],
                    "chat_id": int(self.room_name)
                },
            )
            print(f"✅ [DEBUG] Separate message notification sent to user_{event['recipient__id']}")
        except Exception as e:
            print(f"❌ [DEBUG] Error sending separate notification: {e}")
            import traceback
            traceback.print_exc()

    @sync_to_async
    def save_message(self, user1_id, user2_id, message, timestamp, user):
        try:
            with transaction.atomic():
                user1 = CustomUser.objects.get(pk=user1_id)
                user2 = CustomUser.objects.get(pk=user2_id)

                # Безопасно получаем room_id из URL
                try:
                    room_id = int(self.room_name)
                    print(f"Parsed room_id: {room_id}")
                except ValueError:
                    logger.error(f"Invalid room_name format: {self.room_name}")
                    room = self.get_or_create_room_by_users(user1, user2)
                    if not room:
                        return None
                    room_id = room.id

                try:
                    room = PrivateChatRoom.objects.get(id=room_id)
                    print(f"Found room: {room.id}, user1: {room.user1.id}, user2: {room.user2.id}")

                    if not ((room.user1 == user1 and room.user2 == user2) or
                            (room.user1 == user2 and room.user2 == user1)):
                        logger.error(f"Users {user1_id} and {user2_id} don't belong to room {room_id}")
                        return None

                except PrivateChatRoom.DoesNotExist:
                    logger.error(f"Chat room with id {room_id} not found")
                    room = self.get_or_create_room_by_users(user1, user2)
                    if not room:
                        return None

                recipient = user2 if user.id == user1_id else user1
                print(f"Recipient determined: {recipient.id}")

                new_message = PrivateMessage.objects.create(
                    room=room,
                    sender=user,
                    recipient=recipient,
                    message=message,
                    timestamp=datetime.fromtimestamp(timestamp)
                )

                logger.info(f"Message saved: room={room.id}, sender={user.id}, recipient={recipient.id}")
                print(f"Message created with ID: {new_message.id}")

                return new_message

        except CustomUser.DoesNotExist as e:
            logger.error(f"User not found: user1_id={user1_id}, user2_id={user2_id}")
            return None
        except Exception as e:
            logger.exception(f"Error saving message: {str(e)}")
            return None

    # Добавьте этот метод после save_message:
    async def notify_chat_list_update(self, user1_id, user2_id):
        """Уведомляет об обновлении списков чатов"""
        try:
            channel_layer = get_channel_layer()

            # Отправляем обновление списка чатов обоим пользователям
            await channel_layer.group_send(
                f"chat_list_{user1_id}",
                {"type": "chat_list_update"}
            )
            await channel_layer.group_send(
                f"chat_list_{user2_id}",
                {"type": "chat_list_update"}
            )

            print(f"✅ [DEBUG] Chat list update sent to users {user1_id} and {user2_id}")
        except Exception as e:
            print(f"❌ [DEBUG] Error sending chat list update: {e}")

    def get_or_create_room_by_users(self, user1, user2):
        """Находит или создает комнату для двух пользователей"""
        try:
            # Ищем существующую комнату
            room = PrivateChatRoom.objects.filter(
                Q(user1=user1, user2=user2) | Q(user1=user2, user2=user1)
            ).first()

            if not room:
                # Создаем новую комнату
                room = PrivateChatRoom.objects.create(user1=user1, user2=user2)
                logger.info(f"Created new room: {room.id}")

            return room
        except Exception as e:
            logger.error(f"Error getting/creating room: {str(e)}")
            return None

    @database_sync_to_async
    def send_push_notification(self, recipient, sender, message_text, chat_id):
        """Отправляет Push-уведомление о новом сообщении"""
        try:
            # Получаем токен получателя
            if recipient.expo_push_token:
                sender_name = sender.get_full_name() or sender.username

                # Отправляем Push-уведомление
                PushNotificationService.send_message_notification(
                    expo_tokens=[recipient.expo_push_token],
                    sender_name=sender_name,
                    message_text=message_text,
                    chat_id=chat_id
                )

                logger.info(f"Push notification sent to {recipient.username} from {sender.username}")
            else:
                logger.info(f"No push token for user {recipient.username}")

        except Exception as e:
            logger.error(f"Error sending push notification: {str(e)}")


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        logger.info(f"WebSocket connection attempt from {self.scope['client']}")
        logger.info("WebSocket connection accepted")

        try:
            self.user_id = self.scope['user'].id
            if not self.user_id:
                await self.close()
                return

            # Добавляем пользователя в общую группу для статусов
            await self.channel_layer.group_add("online_status", self.channel_name)
            await self.channel_layer.group_add(f"user_{self.user_id}", self.channel_name)

            # Устанавливаем статус онлайн и уведомляем других
            await self.send_user_online(self.user_id)
            await self.broadcast_user_status(self.user_id, 'online')

            await self.accept()

            # Отправляем начальные данные
            unread_sender_count = await self.get_unique_senders_count(self.user_id)
            messages_by_sender = await self.get_messages_by_sender(self.user_id)
            await self.send_initial_notification(unread_sender_count, messages_by_sender)

        except Exception as e:
            print(f'Error connecting to notification: {e}')
            await self.close()

    async def separate_message_notification(self, event):
        """Обработчик для индивидуальных уведомлений о сообщениях"""
        try:
            print(f"🔔 [DEBUG] Processing separate message notification: {event}")

            # Получаем актуальное количество непрочитанных сообщений от этого отправителя
            sender_message_count = await self.get_sender_message_count(self.user_id, event['sender_id'])

            # Создаем сообщение в формате, понятном клиенту
            message_data = {
                'sender_id': event['sender_id'],
                'sender_name': event['sender_name'],
                'count': sender_message_count,  # Реальное количество непрочитанных сообщений
                'last_message': event['message'],
                'timestamp': event['timestamp'],
                'message_id': event['message_id'],
                'chat_id': event['chat_id']
            }

            # Формируем ответ с отдельным типом для нового сообщения
            response = {
                'type': 'individual_message',
                'message': message_data
            }

            # Отправляем индивидуальное уведомление
            await self.send(text_data=json.dumps(response))
            print(f"✅ [DEBUG] Individual message notification sent: {response}")

        except Exception as e:
            print(f"❌ [DEBUG] Error in separate_message_notification: {e}")
            import traceback
            traceback.print_exc()

    async def direct_message_notification(self, event):
        """Отправка прямого уведомления о новом сообщении"""
        try:
            user_id = event['user_id']
            print(f"💬 [DEBUG] Sending direct message notification to user {user_id}")

            # Данные сообщения уже готовы к отправке
            message_data = event.get('data', {})

            # Создаем структуру ответа
            response_data = {
                'type': 'new_message_notification',
                'message': message_data
            }

            # Отправляем уведомление о новом сообщении
            await self.send(text_data=json.dumps(response_data))
            print(f"📨 [DEBUG] Direct notification sent: {response_data}")

            # Обновляем общий список уведомлений для консистентности
            await self.send_notification_update(user_id)
        except Exception as e:
            print(f"❌ [DEBUG] Error in direct_message_notification: {e}")
            import traceback
            traceback.print_exc()

    async def send_notification_update(self, user_id):
        """Отправляет обновленный список уведомлений"""
        try:
            unread_sender_count = await self.get_unique_senders_count(user_id)
            messages_by_sender = await self.get_messages_by_sender(user_id)

            response_data = {
                'type': 'messages_by_sender_update',
                'unique_sender_count': unread_sender_count,
                'messages': messages_by_sender
            }

            await self.send(text_data=json.dumps(response_data))
        except Exception as e:
            print(f"❌ [DEBUG] Error sending notification update: {e}")

    async def send_initial_notification(self, unread_sender_count, messages_by_sender):
        print(f"📡 [DEBUG] Sending initial notification: count={unread_sender_count}")
        print(f"📋 [DEBUG] Messages data: {messages_by_sender}")

        response_data = {
            "type": "initial_notification",
            "unique_sender_count": unread_sender_count,
            "messages": messages_by_sender
        }

        print(f"📤 [DEBUG] Initial notification data being sent: {response_data}")
        await self.send(text_data=json.dumps(response_data))

    async def notification_message(self, event):
        """Обработчик для получения уведомлений о новых сообщениях"""
        try:
            print(f"🔔 [DEBUG] Individual message notification for user {self.user_id}")

            # Создаем данные для одиночного сообщения
            sender_id = event['sender_id']
            message_text = event['message']
            timestamp = event['timestamp']

            try:
                # Получаем информацию об отправителе
                sender = await self.get_user_info(sender_id)
                sender_name = f"{sender.first_name} {sender.last_name}" if sender else f"User {sender_id}"
            except Exception as e:
                print(f"❌ [DEBUG] Error getting sender info: {e}")
                sender_name = f"User {sender_id}"

            # Формируем сообщение
            message_data = {
                'sender_id': sender_id,
                'sender_name': sender_name,
                'count': 1,  # Всегда 1 для индивидуальных уведомлений
                'last_message': message_text,
                'timestamp': datetime.fromtimestamp(timestamp).isoformat() if isinstance(timestamp, int) else timestamp,
                'message_id': f"temp_{timestamp}"  # Временный ID для индивидуальных уведомлений
            }

            # Отправляем уведомление о новом сообщении
            response_data = {
                'type': 'new_message_notification',
                'message': message_data
            }

            print(f"📤 [DEBUG] Sending individual message notification: {response_data}")
            await self.send(text_data=json.dumps(response_data))

            # Обновляем общие данные для поддержания консистентности
            unread_sender_count = await self.get_unique_senders_count(self.user_id)
            messages_by_sender = await self.get_messages_by_sender(self.user_id)

            update_data = {
                'type': 'messages_by_sender_update',
                'messages': messages_by_sender,
                "unique_sender_count": unread_sender_count,
            }

            # Отправляем общий список после индивидуального уведомления
            await self.send(text_data=json.dumps(update_data))

        except Exception as e:
            print(f"❌ [DEBUG] Error in notification_message: {e}")
            import traceback
            traceback.print_exc()

    @database_sync_to_async
    def get_user_info(self, user_id):
        try:
            return CustomUser.objects.get(pk=user_id)
        except CustomUser.DoesNotExist:
            print(f"❌ [DEBUG] User {user_id} not found")
            return None
        except Exception as e:
            print(f"❌ [DEBUG] Error in get_user_info: {e}")
            return None

    @database_sync_to_async
    def send_user_online(self, user_id):
        try:
            user = CustomUser.objects.get(pk=user_id)
            user.is_online = 'online'
            user.save()
            return user
        except CustomUser.DoesNotExist:
            print(f"User {user_id} not found")
            return None

    @database_sync_to_async
    def send_user_offline(self, user_id):
        try:
            user = CustomUser.objects.get(pk=user_id)
            user.is_online = 'offline'
            user.save()
            return user
        except CustomUser.DoesNotExist:
            print(f"User {user_id} not found")
            return None

    async def broadcast_user_status(self, user_id, status):
        """Рассылаем изменение статуса всем подключенным пользователям"""
        try:
            await self.channel_layer.group_send(
                "online_status",
                {
                    'type': 'user_status_update',
                    'user_id': user_id,
                    'status': status
                }
            )
        except Exception as e:
            print(f'Error broadcasting user status: {e}')

    async def disconnect(self, close_code):
        try:
            # Убираем из групп
            await self.channel_layer.group_discard("online_status", self.channel_name)
            await self.channel_layer.group_discard(f"user_{self.user_id}", self.channel_name)

            # Устанавливаем статус оффлайн и уведомляем других
            await self.send_user_offline(self.user_id)
            await self.broadcast_user_status(self.user_id, 'offline')

        except Exception as e:
            print(f'Error disconnecting from notification: {e}')

    async def receive(self, text_data):
        # Этот метод не используется в данном примере, но может быть полезен для других задач
        pass

    async def notification(self, event):
        user_id = event['user_id']
        try:
            print(f"🔔 [DEBUG] Notification event for user {user_id}")
            messages_by_sender = await self.get_messages_by_sender(user_id)
            print(f"📨 [DEBUG] Messages by sender result: {messages_by_sender}")

            unread_sender_count = await self.get_unique_senders_count(self.user_id)

            response_data = {
                'type': 'messages_by_sender_update',
                'messages': messages_by_sender,
                "unique_sender_count": unread_sender_count,
            }

            print(f"📤 [DEBUG] Sending to WebSocket client: {response_data}")
            await self.send(text_data=json.dumps(response_data))
        except Exception as e:
            print(f"❌ [DEBUG] Error in NotificationConsumer.notification: {e}")
            import traceback
            traceback.print_exc()

    async def user_status_update(self, event):
        """Обработчик для получения обновлений статуса пользователей"""
        try:
            await self.send(text_data=json.dumps({
                'type': 'user_status_update',
                'user_id': event['user_id'],
                'status': event['status']
            }))
        except Exception as e:
            print(f"Error in user_status_update: {e}")

    @database_sync_to_async
    def get_unique_senders_count(self, user_id):
        try:
            user = CustomUser.objects.get(pk=user_id)
            unread_messages = PrivateMessage.objects.filter(recipient=user, read=False)
            unique_senders = set(unread_messages.values_list('sender_id', flat=True))
            return len(unique_senders)
        except CustomUser.DoesNotExist:
            return 0
        except Exception as e:
            print(f"Error in get_unique_senders_count: {e}")
            return 0

    @database_sync_to_async
    def get_sender_message_count(self, user_id, sender_id):
        """Получает количество непрочитанных сообщений от конкретного отправителя"""
        try:
            user = CustomUser.objects.get(pk=user_id)
            count = PrivateMessage.objects.filter(
                recipient=user,
                sender_id=sender_id,
                read=False
            ).count()
            print(f"📊 [DEBUG] User {user_id} has {count} unread messages from sender {sender_id}")
            return count
        except CustomUser.DoesNotExist:
            print(f"❌ [DEBUG] User {user_id} not found")
            return 0
        except Exception as e:
            print(f"❌ [DEBUG] Error in get_sender_message_count: {e}")
            return 0

    @database_sync_to_async
    def get_messages_by_sender(self, user_id):
        try:
            user = CustomUser.objects.get(pk=user_id)
            us_dict = {'user': f'{user.first_name} {user.last_name}'}

            print(f"🔍 [DEBUG] Getting messages for user {user_id} ({user.username})")

            # Получаем все непрочитанные сообщения, сгруппированные по отправителю
            unread_messages = PrivateMessage.objects.filter(
                recipient=user,
                read=False
            ).select_related('sender', 'room')

            print(f"📊 [DEBUG] Total unread messages: {unread_messages.count()}")

            # Группируем по отправителям
            sender_messages = {}
            for message in unread_messages:
                sender_id = message.sender_id
                if sender_id not in sender_messages:
                    sender_messages[sender_id] = {
                        'count': 0,
                        'last_message': message,
                        'sender': message.sender
                    }
                sender_messages[sender_id]['count'] += 1

                # Обновляем последнее сообщение, если текущее новее
                if message.timestamp > sender_messages[sender_id]['last_message'].timestamp:
                    sender_messages[sender_id]['last_message'] = message

            print(f"📝 [DEBUG] Unique senders: {len(sender_messages)}")

            messages_by_sender = []

            for sender_id, data in sender_messages.items():
                sender = data['sender']
                message_count = data['count']
                last_message = data['last_message']

                print(f"📤 [DEBUG] Sender {sender_id}: {message_count} unread messages")

                try:
                    sender_name = f"{sender.first_name} {sender.last_name}".strip()
                    if not sender_name:
                        sender_name = sender.username or f"Пользователь {sender_id}"
                except Exception as e:
                    print(f"❌ [DEBUG] Error getting sender info: {e}")
                    sender_name = f"Пользователь {sender_id}"

                message_data = {
                    'sender_id': sender_id,
                    'sender_name': sender_name,
                    'count': message_count,  # РЕАЛЬНОЕ количество непрочитанных сообщений
                    'last_message': last_message.message,
                    'timestamp': last_message.timestamp.isoformat(),
                    'message_id': last_message.id,
                    'chat_id': last_message.room_id
                }

                messages_by_sender.append(message_data)
                print(
                    f"✅ [DEBUG] Added: User {sender_id} -> {message_count} messages: '{message_data['last_message'][:30]}...'")

            # Сортируем по времени последнего сообщения (новые первые)
            messages_by_sender.sort(key=lambda x: x['timestamp'], reverse=True)

            print(f"🎯 [DEBUG] Final result: {len(messages_by_sender)} senders with messages")
            for msg in messages_by_sender:
                print(f"   - Sender {msg['sender_id']}: {msg['count']} messages")

            return us_dict, messages_by_sender

        except CustomUser.DoesNotExist:
            print(f"❌ [DEBUG] User {user_id} not found")
            return {'user': ''}, []
        except Exception as e:
            print(f"❌ [DEBUG] Error in get_messages_by_sender: {e}")
            import traceback
            traceback.print_exc()
            return {'user': ''}, []


class ChatListConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope['user']

        if self.user.is_anonymous:  # Изменено с if not self.user.is_authenticated
            await self.close()
            return

        self.user_id = str(self.user.id)  # Преобразуем ID в строку для совместимости с JS
        await self.channel_layer.group_add(f"chat_list_{self.user_id}", self.channel_name)
        await self.accept()

        # Отправляем начальные данные о чатах
        await self.send_chat_list()

    async def disconnect(self, close_code):
        if hasattr(self, 'user_id'):
            await self.channel_layer.group_discard(f"chat_list_{self.user_id}", self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            if data.get('type') == 'get_chat_list':
                await self.send_chat_list()
        except Exception as e:
            print(f"Error processing chat list request: {e}")

    async def send_chat_list(self):
        """Отправляет список чатов пользователя"""
        try:
            print(f"Getting chats for user_id: {self.user_id}, type: {type(self.user_id)}")
            chats = await self.get_user_chats(self.user_id)
            print(f"Successfully retrieved {len(chats)} chats")
            await self.send(text_data=json.dumps({
                'type': 'chat_list',
                'chats': chats
            }))
        except Exception as e:
            print(f"Error sending chat list: {e}")
            import traceback
            traceback.print_exc()

    async def chat_list_update(self, event):
        """Обработчик для обновления списка чатов"""
        await self.send_chat_list()

    @database_sync_to_async
    def get_user_chats(self, user_id):
        """Получает все чаты пользователя с полной информацией"""
        try:
            # Преобразуем ID обратно в число, если он строка
            if isinstance(user_id, str):
                user_id = int(user_id)

            user = CustomUser.objects.get(pk=user_id)

            # Получаем все комнаты, где участвует пользователь
            rooms = PrivateChatRoom.objects.filter(
                Q(user1=user) | Q(user2=user)
            ).select_related('user1', 'user2')

            chats = []

            for room in rooms:
                # Определяем другого пользователя
                other_user = room.user2 if room.user1 == user else room.user1

                # Получаем последнее сообщение
                last_message = PrivateMessage.objects.filter(
                    room=room
                ).order_by('-timestamp').first()

                if not last_message:
                    continue  # Пропускаем чаты без сообщений

                # Подсчитываем непрочитанные сообщения от этого пользователя
                unread_count = PrivateMessage.objects.filter(
                    room=room,
                    recipient=user,
                    read=False
                ).count()

                chat_data = {
                    'id': room.id,
                    'other_user': {
                        'id': other_user.id,
                        'username': other_user.username,
                        'first_name': other_user.first_name or '',
                        'last_name': other_user.last_name or '',
                        'avatar': other_user.avatar.url if other_user.avatar else None,
                        'gender': other_user.gender,
                        'is_online': other_user.is_online
                    },
                    'last_message': last_message.message,
                    'last_message_time': last_message.timestamp.isoformat(),
                    'unread_count': unread_count
                }

                chats.append(chat_data)

            # Сортируем по времени последнего сообщения
            chats.sort(key=lambda x: x['last_message_time'], reverse=True)

            print(f"✅ [ChatList] Found {len(chats)} chats for user {user_id}")
            return chats

        except Exception as e:
            print(f"❌ [ChatList] Error getting user chats: {e}")
            return []
