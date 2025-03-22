from django.core.files.storage import default_storage
from django.db import models
from imagekit.models import ProcessedImageField, ImageSpecField
from imagekit.processors import ResizeToFill

from authapp.models import CustomUser


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
        if self.image:
            storage, path = self.image.storage, self.image.path
            storage.delete(path)
        super().delete(*args, **kwargs)

    def __str__(self):
        return self.caption or f"Photo in {self.album.title}"
