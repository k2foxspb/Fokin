import logging

from django.db.models.functions import Coalesce
from django.http import JsonResponse
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Q, F, IntegerField, Case, When, Subquery, OuterRef, Count
from .models import PrivateChatRoom, PrivateMessage, CustomUser
from .serializers import ChatRoomSerializer, MessageSerializer, ChatPreviewSerializer

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def test_push_notification(request):
    """Тестовая отправка push уведомления"""
    try:
        user = request.user
        if not user.expo_push_token:
            return JsonResponse({'error': 'No push token'}, status=400)

        logger.info(f"🧪 [TEST] Sending test push to {user.username}")
        logger.info(f"🧪 [TEST] Token: {user.expo_push_token}")

        from .push_notifications import PushNotificationService

        result = PushNotificationService.send_message_notification(
            expo_tokens=[user.expo_push_token],
            sender_name="Test System",
            message_text="Это тестовое уведомление для проверки push notifications",
            chat_id=999
        )

        logger.info(f"🧪 [TEST] Push notification result: {result}")

        return JsonResponse({
            'success': True,
            'message': 'Test notification sent',
            'token_preview': user.expo_push_token[:30] + '...'
        })

    except Exception as e:
        logger.error(f"❌ [TEST] Error sending test push: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def debug_push_tokens(request):
    """Временный endpoint для проверки push токенов"""
    try:
        user = request.user
        logger.info(f"🔍 [DEBUG] Checking push token for user {user.username}")

        user_data = {
            'user_id': user.id,
            'username': user.username,
            'has_push_token': bool(user.expo_push_token),
            'token_preview': user.expo_push_token,
            'is_active': user.is_active,
        }

        # Проверим всех пользователей с токенами
        users_with_tokens = CustomUser.objects.filter(
            expo_push_token__isnull=False
        ).exclude(expo_push_token='').count()

        logger.info(f"🔍 [DEBUG] Total users with push tokens: {users_with_tokens}")

        return JsonResponse({
            'current_user': user_data,
            'total_users_with_tokens': users_with_tokens,
        })

    except Exception as e:
        logger.error(f"❌ [DEBUG] Error in debug_push_tokens: {e}")
        return JsonResponse({'error': str(e)}, status=500)


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
                    'room': chat.id,
                    'other_user': chat.user2 if chat.user1 == user else chat.user1,
                    'last_message': chat.last_message,
                    'last_message_time': chat.last_message_time,
                    'unread_count': chat.unread_count
                }
                chat_previews.append(chat_preview)

        serializer = ChatPreviewSerializer(chat_previews, many=True)
        return Response(serializer.data)

    # ... остальные методы остаются без изменений ...


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def save_push_token(request):
    try:
        expo_push_token = request.data.get('expo_push_token')
        if expo_push_token:
            request.user.expo_push_token = expo_push_token
            request.user.save()
            return Response({'success': True})
        return Response({'error': 'No token provided'}, status=400)
    except Exception as e:
        return Response({'error': str(e)}, status=500)


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
