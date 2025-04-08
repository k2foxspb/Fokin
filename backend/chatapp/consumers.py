import json
import logging
from datetime import  datetime
from pprint import pprint

from asgiref.sync import async_to_sync, sync_to_async
from channels.generic.websocket import WebsocketConsumer, AsyncWebsocketConsumer
from django.core.exceptions import ObjectDoesNotExist

from authapp.models import CustomUser
from .models import Room, Message, PrivateChatRoom, PrivateMessage
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
        if message.startswith('/pm '):
            split = message.split(' ', 2)
            target = split[1]
            target_msg = split[2]

            # send private message to the target
            async_to_sync(self.channel_layer.group_send)(
                f'inbox_{target}',
                {
                    'type': 'private_message',
                    'user': self.user.username,
                    'message': target_msg,
                }
            )
            # send private message delivered to the user
            self.send(json.dumps({
                'type': 'private_message_delivered',
                'target': target,
                'message': target_msg,
            }))
            return

        # send chat message event to the room
        async_to_sync(self.channel_layer.group_send)(
            self.room_group_name,
            {
                'type': 'chat_message',
                'user': self.user.username,
                'message': message,
                'time': datetime.astimezone(datetime.now()).strftime('%d.%m.%Y, %H:%M:%S'),
            }
        )
        Message.objects.create(user=self.user, room=self.room, content=message)
        send_message(
            f'name: {self.user}\n'
            f'room: {self.room}\n'
            f'msg: {message}'
        )

    def chat_message(self, event):
        self.send(text_data=json.dumps(event))

    def user_join(self, event):
        self.send(text_data=json.dumps(event))

    def user_leave(self, event):
        self.send(text_data=json.dumps(event))

    def private_message(self, event):
        self.send(text_data=json.dumps(event))

    def private_message_delivered(self, event):
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
            timestamp = text_data_json.get('timestamp')
            user1 = text_data_json['user1'] # получаем id пользователя 1
            user2 = text_data_json['user2'] # получаем id пользователя 2
            print(user1, user2)

            await self.save_message(user1, user2, message, timestamp, self.user)

            await self.channel_layer.group_send(
                self.room_name,
                {
                    'type': 'chat_message',
                    'message': message,
                    'sender': self.user.username,
                    'timestamp': timestamp or 'N/A',
                }
            )
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"Error processing message: {e}")
        except Exception as e:
            logger.exception(f"Error in receive: {e}")

    async def chat_message(self, event):
        await self.send(text_data=json.dumps(event))

    @sync_to_async
    def save_message(self, user1, user2, message, timestamp, user):
        print(user1, user2)
        try:
            # Находим или создаём комнату по user1 и user2
            room, created = PrivateChatRoom.objects.get_or_create(
                user1=CustomUser.objects.get(pk=user1),
                user2=CustomUser.objects.get(pk=user2),
            )
            PrivateMessage.objects.create(room=room, sender=user, message=message, timestamp=timestamp)
        except Exception as e:
            logger.exception(f"Error saving message: {e}")
