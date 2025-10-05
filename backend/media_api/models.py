import os
from pathlib import Path
from time import time

from django.db import models
from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.utils import timezone

from backend.chatapp.models import PrivateChatRoom


def user_directory_path(instance, filename):
    """Генерирует путь для загрузки файла пользователя."""
    num = int(time() * 1000)
    suf = Path(filename).suffix
    return f"{instance.user.username}/{PrivateChatRoom.room_name}/pic_{num}{suf}"


class UploadedFile(models.Model):
    """Базовая модель для всех загруженных файлов."""
    FILE_TYPES = [
        ('image', 'Изображение'),
        ('video', 'Видео'),
        ('document', 'Документ'),
        ('other', 'Другое'),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, 
        on_delete=models.CASCADE,
        verbose_name='Пользователь'
    )
    file = models.FileField(
        upload_to=user_directory_path,
        verbose_name='Файл',
        max_length=255
    )
    file_type = models.CharField(
        max_length=20, 
        choices=FILE_TYPES,
        verbose_name='Тип файла'
    )
    original_name = models.CharField(
        max_length=255, 
        verbose_name='Исходное имя файла'
    )
    file_size = models.PositiveIntegerField(
        verbose_name='Размер файла (байты)'
    )
    mime_type = models.CharField(
        max_length=100,
        verbose_name='MIME тип'
    )
    uploaded_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name='Дата загрузки'
    )
    is_public = models.BooleanField(
        default=False,
        verbose_name='Публичный доступ'
    )

    class Meta:
        verbose_name = 'Загруженный файл'
        verbose_name_plural = 'Загруженные файлы'
        ordering = ['-uploaded_at']

    def __str__(self):
        return f"{self.original_name} ({self.user.username})"

    @property
    def file_url(self):
        """Возвращает URL файла."""
        if self.file:
            return self.file.url
        return None

    def delete(self, *args, **kwargs):
        """Удаляет файл при удалении записи."""
        if self.file:
            # Удаляем файл из storage
            self.file.delete(save=False)
        super().delete(*args, **kwargs)


class ImageFile(UploadedFile):
    """Модель для изображений с дополнительными свойствами."""
    width = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Ширина'
    )
    height = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Высота'
    )

    def save(self, *args, **kwargs):
        self.file_type = 'image'
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = 'Изображение'
        verbose_name_plural = 'Изображения'


class VideoFile(UploadedFile):
    """Модель для видео с дополнительными свойствами."""
    duration = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Длительность (секунды)'
    )
    thumbnail = models.ImageField(
        upload_to=user_directory_path,
        null=True, blank=True,
        verbose_name='Миниатюра'
    )

    def save(self, *args, **kwargs):
        self.file_type = 'video'
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = 'Видео'
        verbose_name_plural = 'Видео'
