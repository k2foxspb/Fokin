from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from django.shortcuts import get_object_or_404
from django.http import Http404
from django.db import models

from .models import UploadedFile, ImageFile, VideoFile
from .serializers import (
    FileUploadSerializer, ImageUploadSerializer, VideoUploadSerializer,
    FileResponseSerializer, ImageResponseSerializer, VideoResponseSerializer
)


class BaseUploadView(APIView):
    """Базовый класс для загрузки файлов."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data, context={'request': request})

        if serializer.is_valid():
            try:
                uploaded_file = serializer.save()
                response_serializer = self.get_response_serializer(
                    uploaded_file, 
                    context={'request': request}
                )
                return Response(
                    {
                        'success': True,
                        'message': 'Файл успешно загружен',
                        'file': response_serializer.data
                    },
                    status=status.HTTP_201_CREATED
                )
            except Exception as e:
                return Response(
                    {
                        'success': False,
                        'message': f'Ошибка при загрузке файла: {str(e)}'
                    },
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )

        return Response(
            {
                'success': False,
                'message': 'Ошибка валидации',
                'errors': serializer.errors
            },
            status=status.HTTP_400_BAD_REQUEST
        )

    def get_serializer(self, *args, **kwargs):
        """Должен быть переопределен в дочерних классах."""
        raise NotImplementedError

    def get_response_serializer(self, *args, **kwargs):
        """Должен быть переопределен в дочерних классах."""
        raise NotImplementedError


class FileUploadView(BaseUploadView):
    """API view для загрузки общих файлов."""

    def get_serializer(self, *args, **kwargs):
        return FileUploadSerializer(*args, **kwargs)

    def get_response_serializer(self, *args, **kwargs):
        return FileResponseSerializer(*args, **kwargs)


class ImageUploadView(BaseUploadView):
    """API view для загрузки изображений."""

    def get_serializer(self, *args, **kwargs):
        return ImageUploadSerializer(*args, **kwargs)

    def get_response_serializer(self, *args, **kwargs):
        return ImageResponseSerializer(*args, **kwargs)


class VideoUploadView(BaseUploadView):
    """API view для загрузки видео."""

    def get_serializer(self, *args, **kwargs):
        return VideoUploadSerializer(*args, **kwargs)

    def get_response_serializer(self, *args, **kwargs):
        return VideoResponseSerializer(*args, **kwargs)


class DeleteFileView(APIView):
    """API view для удаления файлов."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, file_id, *args, **kwargs):
        try:
            # Получаем файл, принадлежащий текущему пользователю
            uploaded_file = get_object_or_404(
                UploadedFile, 
                id=file_id, 
                user=request.user
            )

            # Удаляем файл
            file_name = uploaded_file.original_name
            uploaded_file.delete()

            return Response(
                {
                    'success': True,
                    'message': f'Файл "{file_name}" успешно удален'
                },
                status=status.HTTP_200_OK
            )

        except Http404:
            return Response(
                {
                    'success': False,
                    'message': 'Файл не найден или у вас нет прав на его удаление'
                },
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {
                    'success': False,
                    'message': f'Ошибка при удалении файла: {str(e)}'
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class UserFilesListView(APIView):
    """API view для получения списка файлов пользователя."""
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        file_type = request.query_params.get('type')  # image, video, document, other

        queryset = UploadedFile.objects.filter(user=request.user)

        if file_type:
            queryset = queryset.filter(file_type=file_type)

        files = []
        for uploaded_file in queryset:
            if isinstance(uploaded_file, ImageFile):
                serializer = ImageResponseSerializer(uploaded_file, context={'request': request})
            elif isinstance(uploaded_file, VideoFile):
                serializer = VideoResponseSerializer(uploaded_file, context={'request': request})
            else:
                serializer = FileResponseSerializer(uploaded_file, context={'request': request})

            files.append(serializer.data)

        return Response(
            {
                'success': True,
                'count': len(files),
                'files': files
            },
            status=status.HTTP_200_OK
        )


class MessageMediaUrlView(APIView):
    """API view для получения URL медиафайлов сообщений."""
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        try:
            # Извлекаем message_id из URL параметров
            message_id = kwargs.get('message_id')
            if not message_id:
                return Response(
                    {
                        'success': False,
                        'message': 'ID сообщения не указан'
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            # Импортируем модель сообщения из chatapp
            from chatapp.models import Message, PrivateMessage

            # Ищем сообщение в обычных чатах или приватных чатах
            message = None
            try:
                message = Message.objects.get(id=message_id)
            except Message.DoesNotExist:
                try:
                    message = PrivateMessage.objects.get(id=message_id)
                except PrivateMessage.DoesNotExist:
                    return Response(
                        {
                            'success': False,
                            'message': 'Сообщение не найдено'
                        },
                        status=status.HTTP_404_NOT_FOUND
                    )

            # Проверяем права доступа к сообщению
            if hasattr(message, 'sender') and message.sender != request.user:
                # Дополнительная проверка: возможно пользователь имеет доступ к чату
                if hasattr(message, 'room'):
                    # Проверяем доступ к комнате чата
                    room = message.room
                    if hasattr(room, 'users') and request.user not in room.users.all():
                        return Response(
                            {
                                'success': False,
                                'message': 'У вас нет прав доступа к этому сообщению'
                            },
                            status=status.HTTP_403_FORBIDDEN
                        )
                elif hasattr(message, 'sender') and message.sender != request.user:
                    # Для приватных сообщений проверяем, является ли пользователь отправителем или получателем
                    if hasattr(message, 'recipient') and message.recipient != request.user:
                        return Response(
                            {
                                'success': False,
                                'message': 'У вас нет прав доступа к этому сообщению'
                            },
                            status=status.HTTP_403_FORBIDDEN
                        )

            # Логирование для отладки
            print(f"🔍 [DEBUG] MessageMediaUrlView: Processing message_id={message_id}")
            print(f"🔍 [DEBUG] Message found: id={message.id}, sender={getattr(message, 'sender', None)}")

            # Получаем медиафайл, связанный с сообщением
            uploaded_file = None

            # Сначала проверяем прямую связь с файлом в сообщении
            if hasattr(message, 'media_file') and message.media_file:
                uploaded_file = message.media_file
                print(f"🔍 [DEBUG] Found media_file directly in message: {uploaded_file.id}")

            # Если нет прямой связи, ищем по различным критериям
            if not uploaded_file:
                sender = getattr(message, 'sender', None)
                message_timestamp = getattr(message, 'timestamp', None)

                print(f"🔍 [DEBUG] Searching for file by criteria: sender={sender}, message_id={message_id}")

                # Стратегия 1: Поиск по имени файла, содержащему message_id
                if sender:
                    # Ищем файлы с именем, содержащим ID сообщения
                    potential_files = UploadedFile.objects.filter(
                        user=sender
                    ).filter(
                        models.Q(original_name__contains=str(message_id)) |
                        models.Q(file__icontains=f'media_{message_id}') |
                        models.Q(file__icontains=str(message_id))
                    ).order_by('-uploaded_at')

                    if potential_files.exists():
                        uploaded_file = potential_files.first()
                        print(f"🔍 [DEBUG] Found file by name pattern: {uploaded_file.id}, name={uploaded_file.original_name}")

                # Стратегия 2: Поиск по времени загрузки (если есть timestamp сообщения)
                if not uploaded_file and sender and message_timestamp:
                    from django.utils import timezone
                    from datetime import timedelta

                    # Ищем файлы, загруженные в пределах 10 минут от времени сообщения
                    if isinstance(message_timestamp, str):
                        try:
                            from django.utils.dateparse import parse_datetime
                            message_time = parse_datetime(message_timestamp)
                        except:
                            message_time = None
                    else:
                        message_time = message_timestamp

                    if message_time:
                        time_window = timedelta(minutes=10)
                        start_time = message_time - time_window
                        end_time = message_time + time_window

                        potential_files = UploadedFile.objects.filter(
                            user=sender,
                            uploaded_at__gte=start_time,
                            uploaded_at__lte=end_time
                        ).order_by('-uploaded_at')

                        if potential_files.exists():
                            uploaded_file = potential_files.first()
                            print(f"🔍 [DEBUG] Found file by timestamp: {uploaded_file.id}, uploaded_at={uploaded_file.uploaded_at}")

                # Стратегия 3: Поиск по медиа хэшу (если есть в сообщении)
                if not uploaded_file and hasattr(message, 'media_hash') and message.media_hash:
                    # Если в модели UploadedFile есть поле для хэша
                    if hasattr(UploadedFile, 'media_hash'):
                        potential_files = UploadedFile.objects.filter(
                            media_hash=message.media_hash
                        ).order_by('-uploaded_at')

                        if potential_files.exists():
                            uploaded_file = potential_files.first()
                            print(f"🔍 [DEBUG] Found file by media_hash: {uploaded_file.id}")

                # Стратегия 4: Последний загруженный медиафайл пользователя (fallback)
                if not uploaded_file and sender:
                    print(f"🔍 [DEBUG] Fallback: getting latest media file from user {sender.id}")

                    # Ищем последний видео или изображение пользователя
                    from django.db import models as django_models

                    potential_files = UploadedFile.objects.filter(
                        user=sender
                    ).filter(
                        django_models.Q(file_type='video') | 
                        django_models.Q(file_type='image') |
                        django_models.Q(mime_type__startswith='video/') |
                        django_models.Q(mime_type__startswith='image/')
                    ).order_by('-uploaded_at')

                    if potential_files.exists():
                        uploaded_file = potential_files.first()
                        print(f"🔍 [DEBUG] Fallback file found: {uploaded_file.id}, type={uploaded_file.file_type}")

            if not uploaded_file:
                print(f"🔍 [DEBUG] No media file found for message_id={message_id}")
                return Response(
                    {
                        'success': False,
                        'message': f'Медиафайл для сообщения {message_id} не найден'
                    },
                    status=status.HTTP_404_NOT_FOUND
                )

            print(f"🔍 [DEBUG] Final uploaded_file: id={uploaded_file.id}, url={uploaded_file.file.url}")

            # Проверяем права доступа к файлу
            if uploaded_file.user != request.user:
                # Дополнительная проверка: возможно файл используется в чате, к которому пользователь имеет доступ
                # Здесь можно добавить логику проверки доступа к чату
                return Response(
                    {
                        'success': False,
                        'message': 'У вас нет прав доступа к этому файлу'
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

            # Формируем полный URL к файлу
            file_url = request.build_absolute_uri(uploaded_file.file.url)

            # Определяем тип ответа в зависимости от типа файла
            if isinstance(uploaded_file, ImageFile):
                response_data = {
                    'success': True,
                    'file_id': uploaded_file.id,
                    'file_type': 'image',
                    'url': file_url,
                    'original_name': uploaded_file.original_name,
                    'size': uploaded_file.file_size,
                    'mime_type': uploaded_file.mime_type,
                    'width': uploaded_file.width,
                    'height': uploaded_file.height,
                }
            elif isinstance(uploaded_file, VideoFile):
                response_data = {
                    'success': True,
                    'file_id': uploaded_file.id,
                    'file_type': 'video',
                    'url': file_url,
                    'original_name': uploaded_file.original_name,
                    'size': uploaded_file.file_size,
                    'mime_type': uploaded_file.mime_type,
                    'duration': uploaded_file.duration,
                    'width': uploaded_file.width,
                    'height': uploaded_file.height,
                }
            else:
                response_data = {
                    'success': True,
                    'file_id': uploaded_file.id,
                    'file_type': uploaded_file.file_type,
                    'url': file_url,
                    'original_name': uploaded_file.original_name,
                    'size': uploaded_file.file_size,
                    'mime_type': uploaded_file.mime_type,
                }

            return Response(response_data, status=status.HTTP_200_OK)

        except Http404:
            return Response(
                {
                    'success': False,
                    'message': 'Файл не найден'
                },
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {
                    'success': False,
                    'message': f'Ошибка при получении URL файла: {str(e)}'
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
