import json
import logging
from datetime import datetime
from pprint import pprint

from asgiref.sync import async_to_sync, sync_to_async
from channels.generic.websocket import WebsocketConsumer, AsyncWebsocketConsumer
from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Q

from authapp.models import CustomUser
from .models import Room, Message, PrivateChatRoom, PrivateMessage, UserChat
from .telegram import send_message


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
        print(text_data_json)

        if not self.user.is_authenticated:
            return

        async_to_sync(self.channel_layer.group_send)(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'user': self.user.username,
                'timestamp': datetime.now().isoformat()
            }
        )

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






logger = logging.getLogger(__name__)


class PrivateChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.user = self.scope['user']
        logger.info(f"Connecting to room: {self.room_name}, user: {self.user}")

        if not self.user.is_authenticated:
            await self.close()
            return

        await self.channel_layer.group_add(self.room_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_name, self.channel_name)

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message = text_data_json['message']
            timestamp = int(text_data_json['timestamp'])  # Проверка на число
            user1_id = int(text_data_json['user1'])  # Проверка на число
            user2_id = int(text_data_json['user2'])  # Проверка на число

            new_message = await self.save_message(user1_id, user2_id, message, timestamp, self.user)

            if new_message:  # Проверка на None
                await self.channel_layer.group_send(
                    self.room_name,
                    {
                        'type': 'chat_message',
                        'message': message,
                        'sender__username': self.user.username,
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



    @sync_to_async
    def save_message(self, user1_id, user2_id, message, timestamp, user):
        try:
            with transaction.atomic():
                user1 = CustomUser.objects.get(pk=user1_id)
                user2 = CustomUser.objects.get(pk=user2_id)

                room = PrivateChatRoom.objects.get(
                    Q(user1=user1, user2=user2) | Q(user1=user2, user2=user1)
                )

                new_message = PrivateMessage.objects.create(room=room, sender=user, message=message,
                                                            timestamp=datetime.fromtimestamp(timestamp))

                recipient = user2 if user != user2 else user1  # определяем получателя
                user_chat, created = UserChat.objects.get_or_create(user=recipient,
                                                                    chat_room=room)  # обновляем данные получателя
                user_chat.unread_count += 1
                user_chat.last_message = new_message
                user_chat.save()
                return new_message

        except CustomUser.DoesNotExist:
            logger.error(f"User with id {user1_id} or {user2_id} not found")
            return None
        except Exception as e:
            logger.exception(f"Error saving message from user {user}: {e}")
            return None
