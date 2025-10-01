import json
import logging

from rest_framework import generics, permissions, status
from rest_framework.authentication import TokenAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from authapp.models import CustomUser
from chatapp.models import Message, PrivateMessage
from chatapp.serializers import MessageSerializer
from .serializers import UserProfileSerializer, UserListSerializer


@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def bulk_users_info(request):
    """
    Получает информацию о пользователях по их ID
    """
    try:
        # Получаем данные из запроса
        data = request.data
        user_ids = data.get('user_ids', [])

        # Валидация входных данных
        if not isinstance(user_ids, list):
            return Response(
                {'error': 'user_ids должен быть массивом'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not user_ids:
            return Response(
                {'error': 'user_ids не может быть пустым'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Ограничиваем количество запрашиваемых пользователей
        if len(user_ids) > 100:
            return Response(
                {'error': 'Максимальное количество пользователей за раз: 100'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Валидация ID
        try:
            user_ids = [int(user_id) for user_id in user_ids]
        except (ValueError, TypeError):
            return Response(
                {'error': 'Все ID пользователей должны быть числами'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Получаем пользователей из базы данных
        users = CustomUser.objects.filter(id__in=user_ids).values(
            'id',
            'username',
            'first_name',
            'last_name'
        )
import logging
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from django.core.paginator import Paginator
from chatapp.models import PrivateChatRoom, PrivateMessage
from chatapp.serializers import MessageSerializer

logger = logging.getLogger(__name__)

class ChatHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, room_id):
        """
        API для получения истории чата с медиафайлами
        """
        try:
            page = int(request.GET.get('page', 1))
            limit = min(int(request.GET.get('limit', 15)), 50)

            logger.info(f"📜 [CHAT-HISTORY] User {request.user.id} requesting history for room {room_id}")
            logger.info(f"📜 [CHAT-HISTORY] Parameters: page={page}, limit={limit}")

            # Проверяем доступ к комнате
            try:
                room = PrivateChatRoom.objects.get(id=room_id)
                if request.user not in [room.user1, room.user2]:
                    logger.warning(f"📜 [CHAT-HISTORY] Access denied for user {request.user.id}")
                    return Response({'error': 'Access denied'}, status=status.HTTP_403_FORBIDDEN)
            except PrivateChatRoom.DoesNotExist:
                logger.error(f"📜 [CHAT-HISTORY] Room {room_id} not found")
                return Response({'error': 'Room not found'}, status=status.HTTP_404_NOT_FOUND)

            # Получаем сообщения с медиа-полями
            messages_queryset = PrivateMessage.objects.filter(
                room=room
            ).select_related('sender').order_by('-timestamp')

            logger.info(f"📜 [CHAT-HISTORY] Found {messages_queryset.count()} total messages")

            # Пагинация
            paginator = Paginator(messages_queryset, limit)
            if page > paginator.num_pages and paginator.num_pages > 0:
                page = paginator.num_pages

            page_obj = paginator.get_page(page)

            # Сериализуем с медиа-полями
            serializer = MessageSerializer(page_obj, many=True)

            # Подсчитываем медиа-сообщения
            media_messages = [msg for msg in page_obj if msg.is_media_message]
            media_count = len(media_messages)

            logger.info(f"📜 [CHAT-HISTORY] Returning {len(serializer.data)} messages, {media_count} with media")

            # Логируем примеры медиа-сообщений
            if media_count > 0:
                for i, msg in enumerate(media_messages[:3]):  # Первые 3 для примера
                    logger.info(f"📜 [CHAT-HISTORY] Media message {i+1}: ID={msg.id}, type={msg.media_type}, hash={msg.media_hash}")

            response_data = {
                'messages': serializer.data,
                'has_more': page_obj.has_next(),
                'current_page': page,
                'total_pages': paginator.num_pages,
                'media_messages_count': media_count  # Для отладки
            }

            logger.info(f"📜 [CHAT-HISTORY] Response prepared with {len(response_data['messages'])} messages")

            return Response(response_data)

        except Exception as e:
            logger.error(f"📜 [CHAT-HISTORY] Error loading chat history: {str(e)}")
            logger.error(f"📜 [CHAT-HISTORY] Error type: {type(e).__name__}")
            import traceback
            logger.error(f"📜 [CHAT-HISTORY] Traceback: {traceback.format_exc()}")
            return Response(
                {'error': 'Internal server error'}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        # Преобразуем QuerySet в список
        users_list = list(users)

        # Логируем для отладки
        print(f"Bulk users request: IDs {user_ids}, found {len(users_list)} users")

        return Response(users_list, status=status.HTTP_200_OK)

    except json.JSONDecodeError:
        return Response(
            {'error': 'Неверный формат JSON'},
            status=status.HTTP_400_BAD_REQUEST
        )
    except Exception as e:
        print(f"Error in bulk_users_info: {str(e)}")
        return Response(
            {'error': 'Внутренняя ошибка сервера'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


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


@api_view(['POST'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def get_last_messages_by_senders(request):
    """
    Получает последние сообщения от указанных отправителей
    """
    try:
        data = request.data
        sender_ids = data.get('sender_ids', [])

        if not isinstance(sender_ids, list):
            return Response({'error': 'sender_ids должен быть массивом'}, status=400)

        if not sender_ids:
            return Response({'error': 'sender_ids не может быть пустым'}, status=400)

        # Валидация ID
        try:
            sender_ids = [int(sender_id) for sender_id in sender_ids]
        except (ValueError, TypeError):
            return Response({'error': 'Все ID должны быть числами'}, status=400)

        user = request.user
        result = {}

        # Получаем последнее сообщение от каждого отправителя
        for sender_id in sender_ids:
            last_message = PrivateMessage.objects.filter(
                recipient=user,
                sender_id=sender_id,
                read=False
            ).order_by('-timestamp').first()

            if last_message:
                result[str(sender_id)] = {
                    'message': last_message.message,
                    'timestamp': last_message.timestamp.isoformat(),
                    'chat_id': last_message.room_id
                }

        print(f"Last messages API response: {result}")
        return Response(result, status=200)

    except Exception as e:
        print(f"Error in get_last_messages_by_senders: {str(e)}")
        return Response({'error': 'Внутренняя ошибка сервера'}, status=500)
