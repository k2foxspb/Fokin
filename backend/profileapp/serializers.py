from datetime import date
from pathlib import Path

from rest_framework import serializers
from authapp.models import CustomUser


class UserProfileSerializer(serializers.ModelSerializer):
    age = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = ['id', 'username', 'email', 'first_name', 'last_name',
                 'gender', 'birthday', 'avatar', 'avatar_url', 'is_online', 'last_seen', 'age']
        read_only_fields = ['id', 'username', 'is_online', 'last_seen']

    def get_age(self, obj):
        if obj.birthday:
            today = date.today()
            return today.year - obj.birthday.year
        return None

    def get_avatar_url(self, obj):
        if obj.avatar:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.avatar.url)
            return obj.avatar.url
        return None

    def validate_birthday(self, value):
        if value:
            today = date.today()
            # Проверка на дату из будущего
            if value > today:
                raise serializers.ValidationError(
                    "Дата рождения не может быть в будущем"
                )
            # Проверка минимального возраста (13 лет)
            age = today.year - value.year
            if age < 13:
                raise serializers.ValidationError(
                    "Минимальный возраст для регистрации - 13 лет"
                )
        return value

    def validate_gender(self, value):
        if value not in ['male', 'female']:
            raise serializers.ValidationError(
                "Пол может быть только 'male' или 'female'"
            )
        return value

    def validate_first_name(self, value):
        if value and len(value.strip()) < 1:
            raise serializers.ValidationError(
                "Имя не может быть пустым"
            )
        return value.strip()

    def validate_last_name(self, value):
        if value and len(value.strip()) < 1:
            raise serializers.ValidationError(
                "Фамилия не может быть пустой"
            )
        return value.strip()

    def validate_avatar(self, value):
        if value:
            # Проверяем размер файла
            if value.size > 5 * 1024 * 1024:  # 5MB
                raise serializers.ValidationError("Размер файла не должен превышать 5MB")

            # Проверяем расширение файла
            valid_extensions = ['.jpg', '.jpeg', '.png', '.gif']
            ext = Path(value.name).suffix.lower()
            if ext not in valid_extensions:
                raise serializers.ValidationError(
                    f"Поддерживаются только форматы: {', '.join(valid_extensions)}"
                )

            # Проверяем MIME тип
            if not value.content_type.startswith('image/'):
                raise serializers.ValidationError("Загруженный файл должен быть изображением")

        return value


class UserListSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ['id', 'username', 'first_name', 'last_name', 'avatar', 'is_online', 'last_seen', 'gender']
        read_only_fields = ['id', 'username', 'avatar', 'is_online', 'last_seen']
