import mimetypes
from rest_framework import serializers
from PIL import Image
from django.core.files.uploadedfile import InMemoryUploadedFile, TemporaryUploadedFile
from django.conf import settings
from .models import UploadedFile, ImageFile, VideoFile


class FileUploadSerializer(serializers.ModelSerializer):
    """Базовый сериализатор для загрузки файлов."""
    file = serializers.FileField()

    class Meta:
        model = UploadedFile
        fields = ['file', 'is_public']

    def validate_file(self, value):
        """Валидация загружаемого файла."""
        # Проверяем размер файла
        if value.size > settings.MAX_UPLOAD_SIZE:
            raise serializers.ValidationError(
                f'Файл слишком большой. Максимальный размер: {settings.MAX_UPLOAD_SIZE // (1024*1024)} MB'
            )
        return value

    def create(self, validated_data):
        file = validated_data['file']
        user = self.context['request'].user

        # Определяем MIME тип
        mime_type, _ = mimetypes.guess_type(file.name)
        if not mime_type:
            mime_type = 'application/octet-stream'

        # Определяем тип файла
        file_type = self._get_file_type(mime_type)

        # Создаем объект файла
        uploaded_file = UploadedFile.objects.create(
            user=user,
            file=file,
            file_type=file_type,
            original_name=file.name,
            file_size=file.size,
            mime_type=mime_type,
            is_public=validated_data.get('is_public', False)
        )

        return uploaded_file

    def _get_file_type(self, mime_type):
        """Определяет тип файла по MIME типу."""
        if mime_type.startswith('image/'):
            return 'image'
        elif mime_type.startswith('video/'):
            return 'video'
        elif mime_type.startswith('application/') or mime_type.startswith('text/'):
            return 'document'
        else:
            return 'other'


class ImageUploadSerializer(FileUploadSerializer):
    """Сериализатор для загрузки изображений."""

    class Meta:
        model = ImageFile
        fields = ['file', 'is_public']

    def validate_file(self, value):
        """Валидация изображения."""
        value = super().validate_file(value)

        # Проверяем, что это действительно изображение
        try:
            image = Image.open(value)
            image.verify()
        except Exception:
            raise serializers.ValidationError('Файл не является корректным изображением.')

        # Проверяем допустимые форматы
        allowed_formats = ['JPEG', 'PNG', 'GIF', 'WebP']
        if hasattr(image, 'format') and image.format not in allowed_formats:
            raise serializers.ValidationError(
                f'Неподдерживаемый формат изображения. Допустимые: {", ".join(allowed_formats)}'
            )

        return value

    def create(self, validated_data):
        file = validated_data['file']
        user = self.context['request'].user

        # Получаем размеры изображения
        try:
            image = Image.open(file)
            width, height = image.size
        except Exception:
            width, height = None, None

        # Определяем MIME тип
        mime_type, _ = mimetypes.guess_type(file.name)
        if not mime_type:
            mime_type = 'image/jpeg'

        # Создаем объект изображения
        image_file = ImageFile.objects.create(
            user=user,
            file=file,
            original_name=file.name,
            file_size=file.size,
            mime_type=mime_type,
            width=width,
            height=height,
            is_public=validated_data.get('is_public', False)
        )

        return image_file


class VideoUploadSerializer(FileUploadSerializer):
    """Сериализатор для загрузки видео."""

    class Meta:
        model = VideoFile
        fields = ['file', 'is_public']

    def validate_file(self, value):
        """Валидация видео файла."""
        value = super().validate_file(value)

        # Проверяем MIME тип видео
        mime_type, _ = mimetypes.guess_type(value.name)
        if not mime_type or not mime_type.startswith('video/'):
            raise serializers.ValidationError('Файл не является видео.')

        # Проверяем допустимые форматы видео
        allowed_extensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm']
        file_ext = value.name.lower().split('.')[-1]
        if f'.{file_ext}' not in allowed_extensions:
            raise serializers.ValidationError(
                f'Неподдерживаемый формат видео. Допустимые: {", ".join(allowed_extensions)}'
            )

        return value

    def create(self, validated_data):
        file = validated_data['file']
        user = self.context['request'].user

        # Определяем MIME тип
        mime_type, _ = mimetypes.guess_type(file.name)
        if not mime_type:
            mime_type = 'video/mp4'

        # Создаем объект видео
        video_file = VideoFile.objects.create(
            user=user,
            file=file,
            original_name=file.name,
            file_size=file.size,
            mime_type=mime_type,
            is_public=validated_data.get('is_public', False)
        )

        return video_file


class FileResponseSerializer(serializers.ModelSerializer):
    """Сериализатор для ответа с информацией о файле."""
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = UploadedFile
        fields = [
            'id', 'file_url', 'file_type', 'original_name', 
            'file_size', 'mime_type', 'uploaded_at', 'is_public'
        ]

    def get_file_url(self, obj):
        """Возвращает URL файла."""
        if obj.file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.file.url)
            return obj.file.url
        return None


class ImageResponseSerializer(FileResponseSerializer):
    """Сериализатор для ответа с информацией об изображении."""

    class Meta:
        model = ImageFile
        fields = [
            'id', 'file_url', 'file_type', 'original_name', 
            'file_size', 'mime_type', 'uploaded_at', 'is_public',
            'width', 'height'
        ]


class VideoResponseSerializer(FileResponseSerializer):
    """Сериализатор для ответа с информацией о видео."""
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = VideoFile
        fields = [
            'id', 'file_url', 'file_type', 'original_name', 
            'file_size', 'mime_type', 'uploaded_at', 'is_public',
            'duration', 'thumbnail_url'
        ]

    def get_thumbnail_url(self, obj):
        """Возвращает URL миниатюры видео."""
        if obj.thumbnail:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.thumbnail.url)
            return obj.thumbnail.url
        return None
