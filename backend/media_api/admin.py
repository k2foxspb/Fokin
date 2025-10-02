from django.contrib import admin
from django.utils.html import format_html
from .models import UploadedFile, ImageFile, VideoFile


@admin.register(UploadedFile)
class UploadedFileAdmin(admin.ModelAdmin):
    list_display = ['original_name', 'user', 'file_type', 'file_size_formatted', 'uploaded_at', 'is_public']
    list_filter = ['file_type', 'is_public', 'uploaded_at', 'user']
    search_fields = ['original_name', 'user__username', 'user__email']
    readonly_fields = ['file_size', 'mime_type', 'uploaded_at', 'file_preview']

    def file_size_formatted(self, obj):
        """Форматирует размер файла в удобочитаемом виде."""
        size = obj.file_size
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} TB"
    file_size_formatted.short_description = 'Размер'

    def file_preview(self, obj):
        """Показывает превью файла если это изображение."""
        if obj.file_type == 'image' and obj.file:
            return format_html(
                '<img src="{}" style="max-height: 200px; max-width: 200px;" />',
                obj.file.url
            )
        return "Превью недоступно"
    file_preview.short_description = 'Превью'


@admin.register(ImageFile)
class ImageFileAdmin(UploadedFileAdmin):
    list_display = UploadedFileAdmin.list_display + ['width', 'height']
    readonly_fields = UploadedFileAdmin.readonly_fields + ['width', 'height']


@admin.register(VideoFile)
class VideoFileAdmin(UploadedFileAdmin):
    list_display = UploadedFileAdmin.list_display + ['duration']
    readonly_fields = UploadedFileAdmin.readonly_fields + ['duration']

    def file_preview(self, obj):
        """Показывает превью видео через миниатюру."""
        if obj.thumbnail:
            return format_html(
                '<img src="{}" style="max-height: 200px; max-width: 200px;" />',
                obj.thumbnail.url
            )
        elif obj.file:
            return format_html(
                '<video style="max-height: 200px; max-width: 200px;" controls><source src="{}" type="{}"></video>',
                obj.file.url,
                obj.mime_type
            )
        return "Превью недоступно"
