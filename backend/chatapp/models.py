from datetime import datetime
from uuid import uuid4

from django.db.models.signals import pre_save
from django.dispatch import receiver
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
    name = models.CharField(max_length=255, unique=True, blank=True)

    def __str__(self):
        return f"{self.user1.username} and {self.user2.username}"

    @property
    def room_name(self):
        # Generate a unique room name.  Order doesn't matter
        return f"private_chat_{min(self.user1.id, self.user2.id)}_{max(self.user1.id, self.user2.id)}"


@receiver(pre_save, sender=PrivateChatRoom)
def set_room_name(sender, instance, **kwargs):
    if not instance.name:
        instance.name = instance.room_name


class PrivateMessage(models.Model):
    MEDIA_TYPE_CHOICES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
    ]

    room = models.ForeignKey(PrivateChatRoom, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(CustomUser, on_delete=models.CASCADE)
    recipient = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='recipient', default=None)
    message = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)

    # Поля для медиафайлов
    media_type = models.CharField(max_length=10, choices=MEDIA_TYPE_CHOICES, default='text')
    media_hash = models.CharField(max_length=64, blank=True, null=True)
    media_filename = models.CharField(max_length=255, blank=True, null=True)
    media_size = models.BigIntegerField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=['room', 'timestamp']),
            models.Index(fields=['media_hash']),
        ]
        ordering = ['timestamp']

    def __str__(self):
        if self.media_type != 'text':
            return f'{self.room}: [{self.media_type.upper()}] {self.message}'
        return f'{self.room}: {self.message}'

    @property
    def is_media_message(self):
        return self.media_type in ['image', 'video'] and bool(self.media_hash)
