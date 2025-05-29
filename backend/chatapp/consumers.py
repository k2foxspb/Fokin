import json
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
        logger.info(f"Connecting to room: {self.room_name}, user: {self.user}")
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
            if new_message:  # Проверка на None
                await self.channel_layer.group_send(
                    self.room_name,
                    {
                        'type': 'chat_message',
                        'message': message,
                        'sender__username': self.user.username,
                        'recipient__id': recipient,
                        'timestamp': timestamp,
                        'id': new_message.id
                    }
                )
            else:
                logger.error("Failed to save message.")
                await self.send(text_data=json.dumps({'error': 'Failed to save message.'}))

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.error(f"Error processing message from user {self.user}: {e}, data: {text_data}")
        except Exception as e:
            logger.exception(f"Error in receive from user {self.user}: {e}")

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'message': event['message'],
            'sender__username': event['sender__username'],
            'timestamp': event['timestamp'],
            'id': event['id']
        }))
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

                room = PrivateChatRoom.objects.get(
                    Q(user1=user1, user2=user2) | Q(user1=user2, user2=user1)
                )
                recipient = user2 if user != user2 else user1
                new_message = PrivateMessage.objects.create(room=room, sender=user, recipient=recipient,
                                                            message=message,
                                                            timestamp=datetime.fromtimestamp(timestamp))


                return new_message

        except CustomUser.DoesNotExist:
            print(f"User with id {user1_id} or {user2_id} not found")
            return None
        except Exception as e:
            logger.exception(f"Error saving message from user {user}: {e}")
            return None


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        try:
            self.user_id = self.scope['user'].id
            await self.channel_layer.group_add(f"user_{self.user_id}", self.channel_name)
            await self.accept()
            unread_sender_count = await self.get_unique_senders_count(self.user_id)
            messages_by_sender = await self.get_messages_by_sender(self.user_id)
            await self.send_initial_notification(unread_sender_count, messages_by_sender)
        except Exception as e:
            print(f'Error connecting to notification: {e}')
            await self.close() # Закрываем соединение при ошибке


    async def disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard(f"user_{self.user_id}", self.channel_name)
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
                                                  "unique_sender_count": unread_sender_count,}))
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
            messages = PrivateMessage.objects.filter(recipient=user, read=False).values('sender_id').annotate(count=Count('sender_id'))
            return [{'sender_id': msg['sender_id'], 'count': msg['count']} for msg in messages]
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

