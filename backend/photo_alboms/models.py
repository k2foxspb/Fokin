import logging

from django.core.files.storage import default_storage
from django.db import models
from google.cloud import storage
from imagekit.models import ProcessedImageField, ImageSpecField
from imagekit.processors import ResizeToFill

from authapp.models import CustomUser
logger = logging.getLogger(__name__)


class PhotoAlbum(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='albums')
    title = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.title


class Photo(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='photos_by_user')
    album = models.ForeignKey(PhotoAlbum, on_delete=models.CASCADE, related_name='photos')
    image = models.FileField(upload_to='my_files/', storage=default_storage)
    caption = models.CharField(max_length=255, blank=True)
    thumbnail = ImageSpecField(
        source='image',
        processors=[ResizeToFill(100, 100)],
        format='JPEG',
        options={'quality': 90},
    )
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def get_next_photo(self):
        try:
            next_photo = self.album.photos.filter(id__gt=self.id, image__isnull=False).order_by(
                'id').first()  # Изменено
            return next_photo
        except IndexError:
            return None

    def get_previous_photo(self):
        try:
            prev_photo = self.album.photos.filter(id__lt=self.id, image__isnull=False).order_by(
                '-id').first()  # Изменено
            return prev_photo
        except IndexError:
            return None

    def delete(self, *args, **kwargs):
        # Удаляем файл из Yandex Cloud Object Storage

        if self.image:

            try:
                client = storage.Client() #Инициализация клиента без service account, использует default credentials
                bucket_name = 'fokin.fun' # замените на имя вашего бакета
                blob_name = self.image.name
                bucket = client.bucket(bucket_name)
                blob = bucket.blob(blob_name)
                blob.delete()
                logger.info(f"Файл {blob_name} удален из Yandex Cloud Storage.")
            except Exception as e:
                blob_name = self.image.name
                logger.info(f"Ошибка при удалении файла {blob_name} из Yandex Cloud Storage: {e}")
        # Удаляем запись из базы данных
        super().delete(*args, **kwargs)

    def __str__(self):
        return self.caption or f"Photo in {self.album.title}"
