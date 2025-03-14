from django.contrib import admin

from photo_alboms.models import PhotoAlbum, Photo


# Register your models here.
@admin.register(PhotoAlbum)
class RoomAdmin(admin.ModelAdmin):
    search_fields = ['title']
    fields = ['title', 'user']

@admin.register(Photo)
class RoomAdmin(admin.ModelAdmin):
    search_fields = ['caption']
    fields = ['image', 'album', 'caption', 'thumbnail']