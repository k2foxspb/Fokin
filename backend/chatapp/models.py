from datetime import datetime
from uuid import uuid4

from pytils.translit import slugify

from authapp.models import CustomUser
from django.db import models

def unique_slugify(instance, slug):
    """
    Генератор уникальных SLUG для моделей, в случае существования такого SLUG.
    """
    model = instance.__class__
    unique_slug = slugify(slug)
    while model.objects.filter(slug=unique_slug).exists():
        unique_slug = f'{unique_slug}-{uuid4().hex[:8]}'
    return unique_slug


class Room(models.Model):
    name = models.CharField(max_length=128, verbose_name='Название комнаты')
    online = models.ManyToManyField(to=CustomUser)
    slug = models.CharField(verbose_name="URL-адрес", max_length=128)

    def get_online_count(self):
        return self.online.count()

    def join(self, user):
        self.online.add(user)
        self.save()

    def leave(self, user):
        self.online.remove(user)
        self.save()

    def get_message(self):
        return self.message_set.filter(timestamp__month__gt=1).all()

    def __str__(self):

        return f'{self.name} ({self.get_online_count()} online)'

    def save(self, *args, **kwargs):
        """
        Сохранение полей модели при их отсутствии заполнения
        """
        if not self.slug:
            self.slug = unique_slugify(self, self.name)
        super().save(*args, **kwargs)
class Message(models.Model):
    user = models.ForeignKey(to=CustomUser, on_delete=models.CASCADE)
    room = models.ForeignKey(to=Room, on_delete=models.CASCADE)
    content = models.CharField(max_length=512)
    timestamp = models.DateTimeField(auto_now_add=True)


    def get_time_msg(self):
        return self.timestamp.astimezone().strftime('%d.%m.%Y, %H:%M:%S')


    def __str__(self):
        return (f'{self.user.username}:'
                f' {self.content}'
                f' {self.get_time_msg()}')



class PrivateChatRoom(models.Model):
    user1 = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='private_chat_room1')
    user2 = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='private_chat_room2')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Private chat between {self.user1} and {self.user2}"

    @property
    def room_name(self):
        # Generate a unique room name.  Order doesn't matter
        return f"private_chat_{min(self.user1.id, self.user2.id)}_{max(self.user1.id, self.user2.id)}"

class PrivateMessage(models.Model):
    room = models.ForeignKey(PrivateChatRoom, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(CustomUser, on_delete=models.CASCADE)
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)

class UserChat(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='chats')
    chat_room = models.ForeignKey(PrivateChatRoom, on_delete=models.CASCADE)
    last_message = models.OneToOneField(PrivateMessage, on_delete=models.SET_NULL, null=True, blank=True)
    unread_count = models.IntegerField(default=0)

    class Meta:
        unique_together = [['user', 'chat_room']]

    def __str__(self):
        return f"Chat: {self.user} - {self.chat_room}"

