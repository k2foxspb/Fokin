import logging

from django.contrib.auth import get_user_model
from django.db.models.functions import Coalesce
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, F, IntegerField, Case, When, Subquery, OuterRef, Count
from .models import PrivateChatRoom, PrivateMessage
from .serializers import ChatRoomSerializer, ChatPreviewSerializer

logger = logging.getLogger(__name__)



class ChatViewSet(viewsets.GenericViewSet,
                  mixins.RetrieveModelMixin,
                  mixins.ListModelMixin):
    permission_classes = [IsAuthenticated]
    serializer_class = ChatPreviewSerializer

    def get_queryset(self):
        user = self.request.user
        return PrivateChatRoom.objects.filter(
            Q(user1=user) | Q(user2=user)
        )

    @action(detail=False, methods=['get'])
    def list_preview(self, request):
        user = self.request.user

        # Подзапрос для последнего сообщения
        last_message_subquery = Subquery(
            PrivateMessage.objects.filter(
                room=OuterRef('pk')
            ).order_by('-timestamp')[:1].values('message')
        )

        # Подзапрос для времени последнего сообщения
        last_message_time_subquery = Subquery(
            PrivateMessage.objects.filter(
                room=OuterRef('pk')
            ).order_by('-timestamp')[:1].values('timestamp')
        )

        # Подзапрос для подсчета непрочитанных сообщений
        unread_count_subquery = Subquery(
            PrivateMessage.objects.filter(
                room=OuterRef('pk'),
                recipient=user,
                read=False
            ).values('room')
            .annotate(count=Count('id'))
            .values('count')
        )

        # Получаем все чаты пользователя с дополнительной информацией
        chats = PrivateChatRoom.objects.filter(
            Q(user1=user) | Q(user2=user)
        ).annotate(
            other_user=Case(
                When(user1=user, then=F('user2')),
                When(user2=user, then=F('user1')),
                output_field=IntegerField(),
            ),
            last_message=last_message_subquery,
            last_message_time=last_message_time_subquery,
            unread_count=Coalesce(unread_count_subquery, 0)
        ).select_related('user1', 'user2')

        # Подготавливаем данные для сериализации
        chat_previews = []
        for chat in chats:
            if chat.last_message:  # Пропускаем чаты без сообщений
                chat_preview = {
                    'id': chat.id,
                    'other_user': chat.user2 if chat.user1 == user else chat.user1,
                    'last_message': chat.last_message,
                    'last_message_time': chat.last_message_time,
                    'unread_count': chat.unread_count
                }
                chat_previews.append(chat_preview)

        serializer = ChatPreviewSerializer(chat_previews, many=True)
        return Response(serializer.data)




User = get_user_model()


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@csrf_exempt
def save_push_token(request):
    """
    Сохранение push токена пользователя (FCM или Expo)
    """
    try:
        user = request.user
        data = request.data

        fcm_token = data.get('fcm_token')
        expo_token = data.get('expo_push_token')

        if fcm_token:
            # Сохраняем FCM токен
            logger.info(f"Saving FCM token for user {user.username}")
            user.fcm_token = fcm_token
            # Очищаем старый expo токен если есть
            if hasattr(user, 'expo_push_token'):
                user.expo_push_token = None
            user.save()

            return Response({
                'success': True,
                'message': 'FCM token saved successfully',
                'token_type': 'fcm'
            })

        elif expo_token:
            # Сохраняем Expo токен (fallback)
            logger.info(f"Saving Expo token for user {user.username}")
            if hasattr(user, 'expo_push_token'):
                user.expo_push_token = expo_token
            # Очищаем FCM токен если есть
            if hasattr(user, 'fcm_token'):
                user.fcm_token = None
            user.save()

            return Response({
                'success': True,
                'message': 'Expo token saved successfully',
                'token_type': 'expo'
            })
        else:
            return Response({
                'success': False,
                'error': 'No token provided'
            }, status=status.HTTP_400_BAD_REQUEST)

    except Exception as e:
        logger.error(f"Error saving push token: {str(e)}")
        return Response({
            'success': False,
            'error': 'Internal server error'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def get_room_info(request, room_id):
    try:
        room = PrivateChatRoom.objects.get(id=room_id)

        # Определяем, кто является получателем для текущего пользователя
        other_user = room.user2 if room.user1 == request.user else room.user1

        return Response({
            'user1_id': room.user1.id,
            'user2_id': room.user2.id,
            'other_user': {
                'id': other_user.id,
                'username': other_user.username,
                'avatar': other_user.avatar.url if other_user.avatar else None,
                'is_online': other_user.is_online
            }
        })
    except PrivateChatRoom.DoesNotExist:
        return Response({'error': 'Room not found'}, status=404)
