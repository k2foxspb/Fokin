from rest_framework import generics, permissions
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from authapp.models import CustomUser
from chatapp.models import Message, PrivateMessage
from chatapp.serializers import MessageSerializer
from .serializers import UserProfileSerializer


class UserProfileAPIView(generics.RetrieveAPIView):
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        username = self.kwargs.get('username')
        return get_object_or_404(CustomUser, username=username)


class CurrentUserProfileAPIView(generics.RetrieveUpdateAPIView):
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

class ChatHistoryView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = MessageSerializer

    def get_queryset(self):
        room_id = self.kwargs.get('room_id')
        return PrivateMessage.objects.filter(room_id=room_id).order_by('timestamp')

    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        return Response({
            'messages': serializer.data
        })

