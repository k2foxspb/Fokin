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
from django.db.models import Q, Count

from authapp.models import CustomUser
from .models import Room, PrivateChatRoom, PrivateMessage, Message
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
        await self.mark_messages_as_read(self.user, self.room_name)

        await self.accept()
        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            f"user_{self.user.id}",
            {
                "type": "notification",
                "user_id": self.user.id,
            },
        )

    @sync_to_async
    def mark_messages_as_read(self, user, room_name):
        room = PrivateChatRoom.objects.get(id=int(room_name))
        if room:
            PrivateMessage.objects.filter(room_id=room.id, read=False).exclude(sender=user).update(read=True)

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

        await self.send(text_data=json.dumps(message_data))

        # Отправляем уведомление получателю
        channel_layer = get_channel_layer()
        await channel_layer.group_send(
            f"user_{event['recipient__id']}",
            {
                "type": "notification",
                "user_id": event['recipient__id'],
            },
        )

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
                    # Если room_name не число, попробуем найти или создать комнату по пользователям
                    room = self.get_or_create_room_by_users(user1, user2)
                    if not room:
                        return None
                    room_id = room.id

                try:
                    # Пытаемся получить существующую комнату по ID
                    room = PrivateChatRoom.objects.get(id=room_id)
                    print(f"Found room: {room.id}, user1: {room.user1.id}, user2: {room.user2.id}")

                    # Проверяем, что пользователи действительно принадлежат этой комнате
                    if not ((room.user1 == user1 and room.user2 == user2) or
                            (room.user1 == user2 and room.user2 == user1)):
                        logger.error(f"Users {user1_id} and {user2_id} don't belong to room {room_id}")
                        return None

                except PrivateChatRoom.DoesNotExist:
                    logger.error(f"Chat room with id {room_id} not found")
                    # Попробуем создать комнату, если её нет
                    room = self.get_or_create_room_by_users(user1, user2)
                    if not room:
                        return None

                # Определяем получателя
                recipient = user2 if user.id == user1_id else user1
                print(f"Recipient determined: {recipient.id}")

                # Создаем новое сообщение
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


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        try:
            self.user_id = self.scope['user'].id
            if not self.user_id:
                await self.close()
                return
            await self.send_user_online(self.user_id)
            await self.channel_layer.group_add(f"user_{self.user_id}", self.channel_name)
            await self.accept()
            unread_sender_count = await self.get_unique_senders_count(self.user_id)
            messages_by_sender = await self.get_messages_by_sender(self.user_id)
            await self.send_initial_notification(unread_sender_count, messages_by_sender)
        except Exception as e:
            print(f'Error connecting to notification: {e}')
            await self.close()  # Закрываем соединение при ошибке

    @database_sync_to_async
    def send_user_online(self, user_id):
        user = CustomUser.objects.get(pk=user_id)
        user.is_online = 'online'
        user.save()

    @database_sync_to_async
    def send_user_offline(self, user_id):
        user = CustomUser.objects.get(pk=user_id)
        user.is_online = 'offline'
        user.save()

    async def disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard(f"user_{self.user_id}", self.channel_name)
            await self.send_user_offline(self.user_id)
        except Exception as e:
            print(f'Error disconnecting from notification: {e}')

    async def receive(self, text_data):
        # Этот метод не используется в данном примере, но может быть полезен для других задач
        pass

    async def notification(self, event):
        user_id = event['user_id']
        try:
            messages_by_sender = await self.get_messages_by_sender(user_id)
            unread_sender_count = await self.get_unique_senders_count(self.user_id)
            await self.send(text_data=json.dumps({'type': 'messages_by_sender_update', 'messages': messages_by_sender,
                                                  "unique_sender_count": unread_sender_count, }))
        except Exception as e:
            print(f"Error in NotificationConsumer.notification: {e}")

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
    def get_messages_by_sender(self, user_id):
        try:
            user = CustomUser.objects.get(pk=user_id)
            us_dict = {'user': f'{user.first_name} {user.last_name}'}
            messages = PrivateMessage.objects.filter(recipient=user, read=False).values('sender_id').annotate(
                count=Count('sender_id'))
            return us_dict, [{'sender_id': msg['sender_id'], 'count': msg['count']} for msg in messages]

        except CustomUser.DoesNotExist:
            return []
        except Exception as e:
            print(f"Error in get_messages_by_sender: {e}")
            return []

    async def send_initial_notification(self, unread_sender_count, messages_by_sender):
        await self.send(text_data=json.dumps({
            "type": "initial_notification",
            "unique_sender_count": unread_sender_count,
            "messages": messages_by_sender

        }))
