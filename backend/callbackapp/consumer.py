import json

from asgiref.sync import sync_to_async, async_to_sync
from channels.consumer import AsyncConsumer
from websocket import WebSocket
from channels.generic.websocket import WebsocketConsumer

from chatapp.models import Message

class MSGConsumer(WebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.message = None
        self.user = None

    def websocket_connect(self, event):
        self.user = self.scope['user']
        self.accept()
        self.message = Message.objects.all()
        self.send(json.dumps({
            "type": "websocket.accept",
            'user': self.user.username,
            'message': f'hello from consumer{self.message}'
        }))



    def websocket_receive(self, text_data):
        # send the user list to the newly joined user
        self.send(json.dumps({
            'type': 'хуй',
            'text': json.dumps({
                'user': self.user.username,
                'message': f'hello from consumer{self.message}'
            })
        }))
        text_data_json = json.loads(text_data['text'])
        print(text_data_json)

    def websocket_disconnect(self, event):
        print('disconnect')
