from rest_framework import serializers
from authapp.models import CustomUser


class UserProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ['id', 'username', 'email', 'first_name', 'last_name']
        read_only_fields = ['id', 'username']

    def get_age(self, obj):
        if obj.birthday:
            from datetime import date
            today = date.today()
            return today.year - obj.birthday.year
        return None


class UserListSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ['id', 'username', 'first_name', 'last_name', 'avatar', 'is_online']
        read_only_fields = ['id', 'username', 'avatar', 'is_online']
