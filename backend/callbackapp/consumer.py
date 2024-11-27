import json

from channels.consumer import AsyncConsumer


class MSGConsumer(AsyncConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.user = None

    async def websocket_connect(self, event):
        self.user = self.scope['user']
        await self.send({
            "type": "websocket.accept",
            'user': self.user.username,
            'message': f'hello from consumer{self.user}'
        })
        print(self.send(event))

    async def websocket_receive(self, text_data):
        # send the user list to the newly joined user
        await self.send(json.dumps({
            'type': 'user_list',
            'users': self.user.username,
        }))
        text_data_json = json.loads(text_data['text'])
        print(text_data_json)

    async def websocket_disconnect(self, event):
        print('disconnect')
