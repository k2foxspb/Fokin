import logging

from rest_framework import generics, permissions, status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from authapp.models import CustomUser
from chatapp.models import Message, PrivateMessage
from chatapp.serializers import MessageSerializer
from .serializers import UserProfileSerializer, UserListSerializer


class UserProfileAPIView(generics.RetrieveAPIView):
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        username = self.kwargs.get('username')
        return get_object_or_404(CustomUser, username=username)

    def update(self, request, *args, **kwargs):
        try:
            instance = self.get_object()
            serializer = self.get_serializer(instance, data=request.data, partial=True)

            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

logger = logging.getLogger(__name__)

class CurrentUserProfileAPIView(generics.RetrieveUpdateAPIView):
    serializer_class = UserProfileSerializer
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = (MultiPartParser, FormParser, JSONParser)

    def get_object(self):
        return self.request.user

    def put(self, request, *args, **kwargs):
        try:
            instance = self.get_object()

            # Отладочная информация
            logger.debug(f"Files in request: {request.FILES}")
            logger.debug(f"Data in request: {request.data}")

            # Проверяем наличие файла
            if 'avatar' in request.FILES:
                file_obj = request.FILES['avatar']
                logger.debug(f"Received file: {file_obj.name}, size: {file_obj.size}, "
                             f"content_type: {file_obj.content_type}")

            serializer = self.get_serializer(
                instance,
                data=request.data,
                partial=True,
                context={'request': request}
            )

            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)

            logger.error(f"Validation errors: {serializer.errors}")
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            logger.exception("Error in profile update")
            return Response(
                {'detail': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    def patch(self, request, *args, **kwargs):
        return self.put(request, *args, **kwargs)


class UserListAPIView(generics.ListAPIView):
    serializer_class = UserListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        # Exclude the current user from search results
        queryset = CustomUser.objects.exclude(id=self.request.user.id)
        search_query = self.request.query_params.get('search', None)
        if search_query:
            queryset = queryset.filter(username__icontains=search_query)
        return queryset

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
