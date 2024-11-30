from django.db import models

from uuid import uuid4

from pytils.translit import slugify

from authapp.models import CustomUser


class Messages(models.Model):
    user = models.ForeignKey(to=CustomUser, on_delete=models.CASCADE, related_name='ss')
    content = models.CharField(max_length=512)
    timestamp = models.DateTimeField(auto_now_add=True)

    def get_time_msg(self):
        return self.timestamp.astimezone().strftime('%d.%m.%Y, %H:%M:%S')

    def __str__(self):
        return (f'{self.user.username}:'
                f' {self.content}'
                f' {self.get_time_msg()}')


class Online(models.Model):
    online = models.ManyToManyField(to=CustomUser)

    def get_online_count(self):
        return self.online.count()

    def join(self, user):
        self.online.add(user)
        self.save()

    def leave(self, user):
        self.online.remove(user)
        self.save()

    def __str__(self):
        return f'({self.get_online_count()} {self.objects.all()} online)'
