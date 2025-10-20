import logging

from django.contrib.auth import get_user_model
from django.db.models.functions import Coalesce
from django.views.decorators.csrf import csrf_exempt
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, F, IntegerField, Case, When, Subquery, OuterRef, Count, CharField, Value
from .models import PrivateChatRoom, PrivateMessage
from .serializers import ChatRoomSerializer, ChatPreviewSerializer

logger = logging.getLogger(__name__)



class ChatViewSet(viewsets.GenericViewSet,
                  mixins.RetrieveModelMixin,
                  mixins.ListModelMixin):
    permission_classes = [IsAuthenticated]
    serializer_class = ChatRoomSerializer

    def get_queryset(self):
        user = self.request.user
        return PrivateChatRoom.objects.filter(
            Q(user1=user) | Q(user2=user)
        )

    @action(detail=False, methods=['get'],url_path='list-preview')
    def list_preview(self, request):
        user = self.request.user

        # Подзапрос для последнего сообщения с учетом типа медиа
        last_message_subquery = Subquery(
            PrivateMessage.objects.filter(
                room=OuterRef('pk')
            ).order_by('-timestamp')[:1].annotate(
                formatted_message=Case(
                    When(media_type='image', then=Value('📷 Изображение')),
                    When(media_type='video', then=Value('🎥 Видео')),
                    When(media_type='document', then=Value('📄 Документ')),
                    When(media_type='other', then=Value('📎 Файл')),
                    default=F('message'),
                    output_field=CharField(),
                )
            ).values('formatted_message')
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
            # Теперь включаем чаты даже если last_message пустое или None
            # Это может произойти для совсем новых чатов
            if chat.last_message_time:  # Проверяем наличие хотя бы времени
                chat_preview = {
                    'id': chat.id,
                    'other_user': chat.user2 if chat.user1 == user else chat.user1,
                    'last_message': chat.last_message or '📎 Медиафайл',  # Fallback для пустых сообщений
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


@api_view(['POST'])
@permission_classes([IsAuthenticated])
@csrf_exempt
def delete_messages(request):
    """
    Помечает сообщения как удаленные (мягкое удаление)
    """
    try:
        user = request.user
        data = request.data

        message_ids = data.get('message_ids', [])
        room_id = data.get('room_id')

        if not message_ids:
            return Response({
                'success': False,
                'error': 'No message IDs provided'
            }, status=status.HTTP_400_BAD_REQUEST)

        if not room_id:
            return Response({
                'success': False,
                'error': 'Room ID is required'
            }, status=status.HTTP_400_BAD_REQUEST)

        # Проверяем, что пользователь участник чата
        try:
            room = PrivateChatRoom.objects.get(
                Q(id=room_id) & (Q(user1=user) | Q(user2=user))
            )
        except PrivateChatRoom.DoesNotExist:
            return Response({
                'success': False,
                'error': 'Chat room not found or access denied'
            }, status=status.HTTP_403_FORBIDDEN)

        # Получаем сообщения, которые принадлежат пользователю и еще не удалены
        messages_to_delete = PrivateMessage.objects.filter(
            id__in=message_ids,
            room=room,
            sender=user,  # Только свои сообщения можно удалять
            is_deleted=False
        )

        if not messages_to_delete.exists():
            return Response({
                'success': False,
                'error': 'No messages found or you can only delete your own messages'
            }, status=status.HTTP_404_NOT_FOUND)

        # Помечаем сообщения как удаленные
        from django.utils import timezone
        updated_count = messages_to_delete.update(
            is_deleted=True,
            deleted_at=timezone.now(),
            deleted_by=user
        )

        logger.info(f"User {user.username} deleted {updated_count} messages in room {room_id}")

        return Response({
            'success': True,
            'message': f'{updated_count} messages marked as deleted',
            'deleted_count': updated_count,
            'deleted_message_ids': list(messages_to_delete.values_list('id', flat=True))
        })

    except Exception as e:
        logger.error(f"Error deleting messages: {str(e)}")
        return Response({
            'success': False,
            'error': 'Internal server error'
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
