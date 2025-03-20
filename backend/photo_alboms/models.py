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
    album = models.ForeignKey(PhotoAlbum, on_delete=models.CASCADE, related_name='photos')
    image = models.ImageField(upload_to='photos/%Y/%m/%d/')  # Путь для хранения изображений
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
            return self.album.photos.filter(id__gt=self.id).order_by('id')[0]
        except IndexError:
            return None

    def get_previous_photo(self):
        try:
            return self.album.photos.filter(id__lt=self.id).order_by('-id')[0]
        except IndexError:
            return None

    def delete_image(self):
        if self.image:
            try:
                default_storage.delete(self.image.name)
                self.image = None
                self.save()
                return True
            except FileNotFoundError:
                return False

    def __str__(self):
        return self.caption or f"Photo in {self.album.title}"
