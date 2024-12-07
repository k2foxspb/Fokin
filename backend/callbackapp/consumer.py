import json
from datetime import datetime
from pprint import pprint

from authapp.models import CustomUser
from asgiref.sync import async_to_sync
from channels.generic.websocket import WebsocketConsumer

from callbackapp.models import Messages, RoomAdmin
from chatapp.telegram import send_message


class MSGConsumer(WebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.staff_user = None
        self.room = None
        self.user_inbox = None
        self.room_group_name = None
        self.user = None

    def websocket_connect(self, event):
        print(event)
        self.user = self.scope['user']
        self.staff_user = CustomUser.objects.filter(is_staff=True)
        p, created = RoomAdmin.objects.get_or_create(name=f'chat_with_{self.user.username}')
        if created is False:
            self.room = RoomAdmin.objects.get(name=f'chat_with_{self.user.username}')
        else:
            self.room = RoomAdmin.objects.create(name=f'chat_with_{self.user.username}')
        self.room_group_name = self.room.name
        self.accept()

        # join the room group
        async_to_sync(self.channel_layer.group_add)(
            self.room_group_name,
            self.channel_name,
        )
        # send the join event to the room
        async_to_sync(self.channel_layer.group_send)(
            self.room_group_name,
            {
                'type': 'user_join',
                'user': self.user.username,
                'staff': self.user.is_staff,
            }
        )

    def receive(self, text_data=None, bytes_data=None):
        text_data_json = json.loads(text_data)
        message = text_data_json['message']
        print(text_data_json)

        if not self.user.is_authenticated:
            return
        target_msg = message

        # send private message to the target
        async_to_sync(self.channel_layer.group_send)(
            f'inbox_f',
            {
                'type': 'private_message',
                'user': self.user.username,
                'message': target_msg,
            }
        )
        # send private message delivered to the user

        self.send(json.dumps({
            'type': 'private_message_delivered',
            'user': self.user.username,
            'target': 'f',
            'message': target_msg,
        }))

        Messages.objects.create(user=self.user, room=self.room, content=target_msg)

    def websocket_disconnect(self, event):
        print('disconnect')
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
