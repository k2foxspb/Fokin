from uuid import uuid4

from pytils.translit import slugify

from authapp.models import CustomUser
from django.db import models


class Room(models.Model):
    name = models.CharField(max_length=128)
    online = models.ManyToManyField(to=CustomUser, blank=True)
    slug = models.SlugField(max_length=128, unique=True, blank=True)

    def get_online_count(self):
        return self.online.count()

    def join(self, user):
        self.online.add(user)
        self.save()

    def leave(self, user):
        self.online.remove(user)
        self.save()

    def get_message(self):
        return self.message_set.filter(timestamp__month__gt=2).all()

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

    def __str__(self):
        return f'{self.user.username}: {self.content} [{self.timestamp.time()}]'

def unique_slugify(instance, slug):
    """
    Генератор уникальных SLUG для моделей, в случае существования такого SLUG.
    """
    model = instance.__class__
    unique_slug = slugify(slug)
    while model.objects.filter(slug=unique_slug).exists():
        unique_slug = f'{unique_slug}-{uuid4().hex[:8]}'
    return unique_slug
