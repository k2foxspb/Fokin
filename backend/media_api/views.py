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

                # Запускаем фоновую обработку через Celery
                from .tasks import compress_video_task, optimize_image_task, generate_video_thumbnail_task

                if isinstance(uploaded_file, VideoFile):
                    # Фоновое сжатие видео для ускорения передачи
                    compress_video_task.apply_async(
                        args=[uploaded_file.id],
                        countdown=5  # Запуск через 5 секунд
                    )
                    # Генерация превью
                    generate_video_thumbnail_task.apply_async(
                        args=[uploaded_file.id],
                        countdown=2
                    )
                elif isinstance(uploaded_file, ImageFile):
                    # Фоновая оптимизация изображения
                    optimize_image_task.apply_async(
                        args=[uploaded_file.id],
                        countdown=2
                    )

                return Response(
                    {
                        'success': True,
                        'message': 'Файл успешно загружен и отправлен на обработку',
                        'file': response_serializer.data,
                        'processing': True  # Индикатор фоновой обработки
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


class BatchMediaUrlView(APIView):
    """API view для пакетного получения URL медиафайлов."""
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        """
        Получение URL для множества сообщений за один запрос.
        Ожидается JSON: {"message_ids": [1, 2, 3, 4, 5]}
        """
        try:
            from django.core.cache import cache
            from .tasks import prefetch_media_urls_task

            message_ids = request.data.get('message_ids', [])

            if not message_ids or not isinstance(message_ids, list):
                return Response(
                    {
                        'success': False,
                        'message': 'Необходимо передать массив message_ids'
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )

            print(f'⚡ [BATCH-API] Processing batch request for {len(message_ids)} messages')

            results = {}
            cache_hits = 0
            cache_misses = []

            # Проверяем кэш для всех запрошенных сообщений
            for message_id in message_ids[:50]:  # Ограничиваем 50 сообщениями
                cache_key = f'media_url_{message_id}'
                cached_data = cache.get(cache_key)

                if cached_data:
                    results[str(message_id)] = cached_data
                    cache_hits += 1
                else:
                    cache_misses.append(message_id)

            # Если есть промахи кэша, запускаем фоновую задачу для предзагрузки
            if cache_misses:
                print(f'⚡ [BATCH-API] Cache misses: {len(cache_misses)}, starting prefetch task')
                prefetch_media_urls_task.apply_async(args=[cache_misses])

            return Response(
                {
                    'success': True,
                    'total_requested': len(message_ids),
                    'cache_hits': cache_hits,
                    'cache_misses': len(cache_misses),
                    'results': results,
                    'prefetch_started': len(cache_misses) > 0
                },
                status=status.HTTP_200_OK
            )

        except Exception as e:
            return Response(
                {
                    'success': False,
                    'message': f'Ошибка при пакетной загрузке: {str(e)}'
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
    """API view для получения URL медиафайлов сообщений с Redis кэшированием."""
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        try:
            from django.core.cache import cache

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

            # Проверяем Redis кэш для мгновенного ответа
            cache_key = f'media_url_{message_id}'
            cached_data = cache.get(cache_key)

            if cached_data:
                print(f'⚡ [REDIS-CACHE] Cache HIT for message {message_id}')

                # Формируем полный URL с текущим доменом
                if 'file_url' in cached_data and not cached_data['file_url'].startswith('http'):
                    cached_data['url'] = request.build_absolute_uri(cached_data['file_url'])
                else:
                    cached_data['url'] = cached_data.get('file_url', '')

                cached_data['success'] = True
                cached_data['cached'] = True

                return Response(cached_data, status=status.HTTP_200_OK)

            print(f'⚡ [REDIS-CACHE] Cache MISS for message {message_id}')

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

            # КРИТИЧЕСКИ ВАЖНО: Сначала проверяем прямую связь с файлом в сообщении
            if hasattr(message, 'media_file') and message.media_file:
                uploaded_file = message.media_file
                print(f"🔍 [DEBUG] ✅ Found media_file directly in message: {uploaded_file.id}")
                print(f"🔍 [DEBUG] File details: type={uploaded_file.file_type}, name={uploaded_file.original_name}")

            # ТОЛЬКО если нет прямой связи, ищем по message_id в имени файла
            elif not uploaded_file:
                sender = getattr(message, 'sender', None)
                message_timestamp = getattr(message, 'timestamp', None)

                print(f"🔍 [DEBUG] Searching for file by criteria: sender={sender}, message_id={message_id}")

                # Стратегия 1: ТОЧНЫЙ поиск по имени файла с message_id
                if sender:
                    # Ищем файлы с ТОЧНЫМ паттерном media_{message_id}
                    potential_files = UploadedFile.objects.filter(
                        user=sender
                    ).filter(
                        models.Q(file__icontains=f'media_{message_id}.') |  # media_123.mp4
                        models.Q(file__icontains=f'temp_{message_id}.') |   # temp_123.mp4
                        models.Q(original_name__exact=f'media_{message_id}.jpg') |
                        models.Q(original_name__exact=f'media_{message_id}.mp4')
                    ).order_by('-uploaded_at')

                    if potential_files.exists():
                        uploaded_file = potential_files.first()
                        print(f"🔍 [DEBUG] ✅ Found file by EXACT name pattern: {uploaded_file.id}, name={uploaded_file.original_name}")

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

            # Если ничего не найдено - не используем fallback на последний файл
            # Это приводит к неправильным связям
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
                    'file_url': uploaded_file.file.url,  # Относительный URL для кэша
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
                    'file_url': uploaded_file.file.url,  # Относительный URL для кэша
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
                    'file_url': uploaded_file.file.url,  # Относительный URL для кэша
                    'original_name': uploaded_file.original_name,
                    'size': uploaded_file.file_size,
                    'mime_type': uploaded_file.mime_type,
                }

            # Кэшируем результат в Redis на 1 час для мгновенного доступа при повторных запросах
            cache_key = f'media_url_{message_id}'
            cache.set(cache_key, response_data, timeout=3600)  # 1 час

            print(f'⚡ [REDIS-CACHE] Cached media URL for message {message_id}')

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
