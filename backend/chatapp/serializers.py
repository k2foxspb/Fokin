from rest_framework import serializers
from .models import PrivateChatRoom, PrivateMessage, CustomUser


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomUser
        fields = ['id', 'username', 'avatar', 'gender', 'is_online', 'first_name', 'last_name']


class MessageSerializer(serializers.ModelSerializer):
    sender__username = serializers.CharField(source='sender.username', read_only=True)
    sender_id = serializers.IntegerField(source='sender.id', read_only=True)

    # Поля для медиафайлов
    mediaType = serializers.CharField(source='media_type', read_only=True)
    mediaHash = serializers.CharField(source='media_hash', read_only=True) 
    mediaFileName = serializers.CharField(source='media_filename', read_only=True)
    mediaSize = serializers.IntegerField(source='media_size', read_only=True)

    class Meta:
        model = PrivateMessage
        fields = [
            'id', 'message', 'sender__username', 'timestamp', 'read', 'sender_id',
            'mediaType', 'mediaHash', 'mediaFileName', 'mediaSize'
        ]



class ChatRoomSerializer(serializers.ModelSerializer):
    user1 = UserSerializer(read_only=True)
    user2 = UserSerializer(read_only=True)

    class Meta:
        model = PrivateChatRoom
        fields = ['id', 'user1', 'user2']


class ChatPreviewSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    other_user = UserSerializer(read_only=True)
    last_message = serializers.CharField()
    last_message_time = serializers.DateTimeField()
    unread_count = serializers.IntegerField()