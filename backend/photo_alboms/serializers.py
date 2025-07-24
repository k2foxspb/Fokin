from rest_framework import serializers
from .models import PhotoAlbum, Photo


class PhotoSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = Photo
        fields = ['id', 'image', 'image_url', 'thumbnail_url', 'caption',
                 'uploaded_at', 'user', 'album']
        read_only_fields = ['id', 'uploaded_at', 'image_url', 'thumbnail_url']

    def create(self, validated_data):
        return Photo.objects.create(**validated_data)


    def get_image_url(self, obj):
        if obj.image:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.image.url)
            return obj.image.url
        return None

    def get_thumbnail_url(self, obj):
        if hasattr(obj, 'thumbnail') and obj.thumbnail:
            request = self.context.get('request')
            try:
                if request:
                    return request.build_absolute_uri(obj.thumbnail.url)
                return obj.thumbnail.url
            except Exception as e:
                print(f"Error generating thumbnail URL: {e}")
                # Fallback to main image if thumbnail fails
                if obj.image:
                    if request:
                        return request.build_absolute_uri(obj.image.url)
                    return obj.image.url
        return None

    def validate_image(self, value):
        print("Validating image:", type(value))
        print("Image file attributes:", {
            'size': getattr(value, 'size', None),
            'content_type': getattr(value, 'content_type', None),
            'name': getattr(value, 'name', None),
            'charset': getattr(value, 'charset', None),
        })

        if not value:
            raise serializers.ValidationError("Изображение обязательно")

        # Проверяем размер файла (например, максимум 10MB)
        if value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError(
                "Размер файла не должен превышать 10MB"
            )

        # Проверяем тип файла
        valid_types = ['image/jpeg', 'image/png', 'image/gif']
        if value.content_type not in valid_types:
            raise serializers.ValidationError(
                f"Недопустимый тип файла. Разрешены только: {', '.join(valid_types)}"
            )

        return value

    def validate_caption(self, value):
        """Валидация подписи"""
        if value and len(value.strip()) > 255:
            raise serializers.ValidationError("Подпись не должна превышать 255 символов")
        return value.strip() if value else ''

class PhotoAlbumDetailSerializer(serializers.ModelSerializer):
    photos = PhotoSerializer(many=True, read_only=True)
    photos_count = serializers.SerializerMethodField()
    user = serializers.SerializerMethodField()

    class Meta:
        model = PhotoAlbum
        fields = ['id', 'title', 'hidden_flag', 'created_at', 'photos', 'photos_count', 'user']

    def get_photos_count(self, obj):
        return obj.photos.count()

    def get_user(self, obj):
        return {
            'username': obj.user.username,
            'id': obj.user.id
        }

class PhotoAlbumSerializer(serializers.ModelSerializer):
    cover_photo = serializers.SerializerMethodField()
    photos_count = serializers.SerializerMethodField()

    class Meta:
        model = PhotoAlbum
        fields = ['id', 'title', 'hidden_flag', 'created_at', 'cover_photo', 'photos_count']

    def get_photos_count(self, obj):
        return obj.photos.count()

    def get_cover_photo(self, obj):
        first_photo = obj.photos.first()
        if first_photo:
            return PhotoSerializer(first_photo, context=self.context).data
        return None