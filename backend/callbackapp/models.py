from django.db import models

from uuid import uuid4

from pytils.translit import slugify

from authapp.models import CustomUser


class Message(models.Model):
    user = models.ForeignKey(to=CustomUser, on_delete=models.CASCADE, related_name='ss')
    content = models.CharField(max_length=512)
    timestamp = models.DateTimeField(auto_now_add=True)

    def get_time_msg(self):
        return self.timestamp.astimezone().strftime('%d.%m.%Y, %H:%M:%S')

    def __str__(self):
        return (f'{self.user.username}:'
                f' {self.content}'
                f' {self.get_time_msg()}')
