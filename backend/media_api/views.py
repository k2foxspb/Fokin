import base64
import json
import mimetypes
import os
from pathlib import Path

from django.conf import settings
from django.core.files.base import ContentFile
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser, FileUploadParser
from django.shortcuts import get_object_or_404
from django.http import Http404
from django.db import models
from django.utils import timezone

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
                print(f'⚡ [REDIS-CACHE] ✅ Cache HIT for message {message_id}')

                # Проверяем валидность кэша (есть ли все необходимые данные)
                if 'file_url' in cached_data and cached_data.get('file_id'):
                    # Формируем полный URL с текущим доменом
                    if not cached_data['file_url'].startswith('http'):
                        cached_data['url'] = request.build_absolute_uri(cached_data['file_url'])
                    else:
                        cached_data['url'] = cached_data.get('file_url', '')

                    cached_data['success'] = True
                    cached_data['cached'] = True

                    print(f'⚡ [REDIS-CACHE] ✅ Valid cache data, returning from cache')
                    return Response(cached_data, status=status.HTTP_200_OK)
                else:
                    # Невалидные данные в кэше - удаляем и загружаем с сервера
                    print(f'⚡ [REDIS-CACHE] ⚠️ Invalid cache data, deleting and loading from server')
                    cache.delete(cache_key)

            print(f'⚡ [REDIS-CACHE] ❌ Cache MISS for message {message_id} - loading from database')

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
            has_access = False

            # Пользователь - отправитель сообщения
            if hasattr(message, 'sender') and message.sender == request.user:
                has_access = True
                print(f"🔐 [ACCESS] ✅ User is message sender")

            # Пользователь - получатель сообщения (для приватных чатов)
            elif hasattr(message, 'recipient') and message.recipient == request.user:
                has_access = True
                print(f"🔐 [ACCESS] ✅ User is message recipient")

            # Проверка доступа к комнате (для групповых чатов)
            elif hasattr(message, 'room'):
                room = message.room
                if hasattr(room, 'users') and request.user in room.users.all():
                    has_access = True
                    print(f"🔐 [ACCESS] ✅ User is room member")

            # Для приватных диалогов проверяем через room_id
            elif hasattr(message, 'room_id'):
                try:
                    from chatapp.models import PrivateChatRoom
                    room = PrivateChatRoom.objects.get(id=message.room_id)
                    if room.user1 == request.user or room.user2 == request.user:
                        has_access = True
                        print(f"🔐 [ACCESS] ✅ User is private chat participant")
                except Exception as room_error:
                    print(f"🔐 [ACCESS] ⚠️ Error checking room access: {room_error}")

            if not has_access:
                print(f"🔐 [ACCESS] ❌ Access denied for user {request.user.id} to message {message_id}")
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

            # Fallback для старых сообщений без прямой связи: поиск по медиа хэшу
            elif not uploaded_file and hasattr(message, 'media_hash') and message.media_hash:
                sender = getattr(message, 'sender', None)
                media_type = getattr(message, 'media_type', None)

                print(f"🔍 [DEBUG] No direct media_file link, searching by hash: {message.media_hash}")
                print(f"🔍 [DEBUG] Message details: sender={sender.id if sender else None}, media_type={media_type}")

                if sender and media_type in ['image', 'video', 'document', 'other']:
                    from datetime import timedelta

                    # Поиск файла по типу, пользователю и времени (в пределах 30 минут от сообщения)
                    message_time = getattr(message, 'timestamp', None)
                    if message_time:
                        time_window = timedelta(minutes=30)
                        start_time = message_time - time_window
                        end_time = message_time + time_window

                        print(f"🔍 [DEBUG] Searching files: type={media_type}, time_window={start_time} to {end_time}")

                        potential_files = UploadedFile.objects.filter(
                            user=sender,
                            file_type=media_type,
                            uploaded_at__gte=start_time,
                            uploaded_at__lte=end_time
                        ).order_by('-uploaded_at')

                        print(f"🔍 [DEBUG] Found {potential_files.count()} potential files")

                        if potential_files.exists():
                            uploaded_file = potential_files.first()
                            print(f"🔍 [DEBUG] ✅ Found file by hash/time: {uploaded_file.id}")

                            # Обновляем сообщение для будущих запросов
                            try:
                                message.media_file = uploaded_file
                                message.save(update_fields=['media_file'])
                                print(f"🔍 [DEBUG] ✅ Updated message with media_file link")
                            except Exception as update_error:
                                print(f"🔍 [DEBUG] ⚠️ Could not update message: {update_error}")

            # Если ничего не найдено - пробуем расширенный поиск
            if not uploaded_file:
                print(f"🔍 [DEBUG] ❌ No media file found, trying extended search for message_id={message_id}")

                # Расширенный поиск: все файлы отправителя за последний час
                if sender:
                    from datetime import timedelta
                    recent_files = UploadedFile.objects.filter(
                        user=sender,
                        uploaded_at__gte=timezone.now() - timedelta(hours=1)
                    ).order_by('-uploaded_at')

                    print(f"🔍 [DEBUG] Extended search found {recent_files.count()} files in last hour")

                    if recent_files.exists():
                        # Берем самый последний файл
                        uploaded_file = recent_files.first()
                        print(f"🔍 [DEBUG] Using most recent file: {uploaded_file.id} ({uploaded_file.original_name})")

                        # Обновляем сообщение для будущих запросов
                        try:
                            message.media_file = uploaded_file
                            message.save(update_fields=['media_file'])
                            print(f"🔍 [DEBUG] ✅ Updated message with media_file link")
                        except Exception as update_error:
                            print(f"🔍 [DEBUG] ⚠️ Could not update message: {update_error}")

                # Если все равно не найдено - возвращаем ошибку
                if not uploaded_file:
                    print(f"🔍 [DEBUG] ❌ No media file found even after extended search")
                    return Response(
                        {
                            'success': False,
                            'message': f'Медиафайл для сообщения {message_id} не найден'
                        },
                        status=status.HTTP_404_NOT_FOUND
                    )

            print(f"🔍 [DEBUG] Final uploaded_file: id={uploaded_file.id}, url={uploaded_file.file.url}")

            # Проверяем права доступа к файлу
            file_has_access = False

            # Пользователь - владелец файла
            if uploaded_file.user == request.user:
                file_has_access = True
                print(f"🔐 [FILE-ACCESS] ✅ User is file owner")

            # Файл используется в сообщении, к которому пользователь имеет доступ
            # Так как мы уже проверили доступ к сообщению выше, то имеем право на файл
            else:
                # Проверяем, является ли пользователь участником диалога
                if hasattr(message, 'sender') and hasattr(message, 'recipient'):
                    # Приватный диалог
                    if message.sender == request.user or message.recipient == request.user:
                        file_has_access = True
                        print(f"🔐 [FILE-ACCESS] ✅ User is participant of private chat")
                elif hasattr(message, 'room_id'):
                    # Проверяем через room_id
                    try:
                        from chatapp.models import PrivateChatRoom
                        room = PrivateChatRoom.objects.get(id=message.room_id)
                        if room.user1 == request.user or room.user2 == request.user:
                            file_has_access = True
                            print(f"🔐 [FILE-ACCESS] ✅ User is participant via room_id")
                    except Exception as room_check_error:
                        print(f"🔐 [FILE-ACCESS] ⚠️ Error checking room: {room_check_error}")

                # Проверка для групповых чатов
                if not file_has_access and hasattr(message, 'room'):
                    room = message.room
                    if hasattr(room, 'users') and request.user in room.users.all():
                        file_has_access = True
                        print(f"🔐 [FILE-ACCESS] ✅ User is group chat member")

            if not file_has_access:
                print(f"🔐 [FILE-ACCESS] ❌ File access denied for user {request.user.id} to file {uploaded_file.id}")
                print(f"🔐 [FILE-ACCESS] File owner: {uploaded_file.user.id}, requesting user: {request.user.id}")
                print(f"🔐 [FILE-ACCESS] Message sender: {getattr(message, 'sender', None)}, recipient: {getattr(message, 'recipient', None)}")
                return Response(
                    {
                        'success': False,
                        'message': 'У вас нет прав доступа к этому файлу'
                    },
                    status=status.HTTP_403_FORBIDDEN
                )

            print(f"🔐 [FILE-ACCESS] ✅ Access granted to file {uploaded_file.id} for user {request.user.id}")

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
                # Для документов и других типов файлов
                response_data = {
                    'success': True,
                    'file_id': uploaded_file.id,
                    'file_type': uploaded_file.file_type,  # 'document', 'other', etc.
                    'url': file_url,
                    'file_url': uploaded_file.file.url,  # Относительный URL для кэша
                    'original_name': uploaded_file.original_name,
                    'size': uploaded_file.file_size,
                    'mime_type': uploaded_file.mime_type,
                }

                # Логируем для отладки
                print(f'📄 [MEDIA-API] Returning document/file URL: {uploaded_file.file_type}')

            # Кэшируем результат в Redis для быстрого доступа при повторных запросах
            # TTL берем из настроек (по умолчанию 24 часа)
            from django.conf import settings
            cache_ttl = getattr(settings, 'CACHE_TTL', {}).get('media_url', 86400)

            cache_key = f'media_url_{message_id}'
            cache.set(cache_key, response_data, timeout=cache_ttl)

            print(f'⚡ [REDIS-CACHE] ✅ Cached media URL for message {message_id} (TTL: {cache_ttl}s)')

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


# Папка внутри MEDIA_ROOT, где будем складывать промежуточные файлы.
# Если хотите хранить её в другом месте – просто поменяйте путь.
CHUNK_TMP_ROOT = Path(settings.MEDIA_ROOT) / '_temp_uploads'

# Убедимся, что директория существует при старте процесса.
# (в production это делается один раз, но вызов не стоит дорого)
CHUNK_TMP_ROOT.mkdir(parents=True, exist_ok=True)
class MediaFinalizeUploadAPIView(APIView):
    """
    POST /media-api/upload/finalize/
    Параметры (JSON):
        {
            "upload_id": "uuid",
            "room_id": <int>,                    # обязательный – куда привязываем файл
            "message_id": <int|null>,            # если уже есть сообщение (оптимистичный)
            "is_public": true/false
        }
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def post(self, request):
        data = request.data
        upload_id = data.get('upload_id')
        room_id = data.get('room_id')
        message_id = data.get('message_id')
        is_public = data.get('is_public', False)

        if not upload_id or not room_id:
            return Response(
                {'success': False, 'message': 'upload_id и room_id обязательны'},
                status=status.HTTP_400_BAD_REQUEST
            )

        tmp_dir = CHUNK_TMP_ROOT / upload_id
        meta_path = tmp_dir / 'meta.json'
        if not meta_path.exists():
            return Response(
                {'success': False, 'message': 'Upload not found'},
                status=status.HTTP_404_NOT_FOUND
            )

        meta = json.loads(meta_path.read_text())
        total = meta['total_chunks']
        uploaded = meta['uploaded']

        if len(uploaded) != total:
            return Response(
                {'success': False,
                 'message': f'Не все чанки получены ({len(uploaded)}/{total})'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Собираем файл
        final_path = CHUNK_TMP_ROOT / f'{upload_id}_{meta["file_name"]}'
        with open(final_path, 'wb') as out_f:
            for i in range(total):
                chunk_path = tmp_dir / f'{i:06d}.chunk'
                out_f.write(chunk_path.read_bytes())

        # Очищаем временную папку
        for p in tmp_dir.iterdir():
            p.unlink()
        tmp_dir.rmdir()

        # Определяем MIME
        mime, _ = mimetypes.guess_type(meta['file_name'])
        mime = mime or 'application/octet-stream'

        # Сохраняем в основную модель
        user = request.user
        if meta['media_type'] == 'image':
            model = ImageFile
        elif meta['media_type'] == 'video':
            model = VideoFile
        else:
            model = UploadedFile

        with open(final_path, 'rb') as f:
            django_file = ContentFile(f.read(), name=meta['file_name'])
            uploaded_obj = model.objects.create(
                user=user,
                file=django_file,
                original_name=meta['file_name'],
                file_size=os.path.getsize(final_path),
                mime_type=mime,
                file_type=meta['media_type'],
                is_public=is_public
            )

        # Привязываем к сообщению (если он уже существует)
        if message_id:
            from chatapp.models import Message
            try:
                msg = Message.objects.get(id=message_id, room_id=room_id)
                msg.media_file = uploaded_obj
                msg.save(update_fields=['media_file'])
            except Message.DoesNotExist:
                pass

        # Ссылка будет публичной, если is_public=True
        file_url = request.build_absolute_uri(uploaded_obj.file.url)

        # Очистка временного файла
        os.remove(final_path)

        return Response({
            'success': True,
            'file': {
                'id': uploaded_obj.id,
                'url': file_url,
                'file_type': uploaded_obj.file_type,
                'original_name': uploaded_obj.original_name,
                'size': uploaded_obj.file_size,
                'mime_type': uploaded_obj.mime_type,
            }
        })


class MediaChunkUploadAPIView(APIView):
    """
    POST /media-api/upload/chunked/
    Параметры (JSON):
        {
            "upload_id": "uuid",
            "chunk_index": 0,
            "total_chunks": 5,
            "file_name": "big_video.mp4",
            "media_type": "video",
            "chunk_data": "<base64..."
        }
    """

    permission_classes = [IsAuthenticated]
    parser_classes = (
        MultiPartParser,   # для multipart/form-data
        FileUploadParser,  # для application/octet-stream (файл в теле без формы)
        JSONParser,        # если планируете получать JSON‑метаданные
        FormParser,
    )

    def post(self, request):
        data = request.data
        required = ['upload_id', 'chunk_index', 'total_chunks', 'file_name', 'media_type', 'chunk_data']
        for k in required:
            if k not in data:
                return Response(
                    {'success': False, 'message': f'Missing {k}'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        upload_id = data['upload_id']
        idx = int(data['chunk_index'])
        total = int(data['total_chunks'])
        file_name = data['file_name']
        media_type = data['media_type']
        chunk_b64 = data['chunk_data']

        # Папка для конкретного upload_id
        tmp_dir = CHUNK_TMP_ROOT / upload_id
        tmp_dir.mkdir(parents=True, exist_ok=True)

        # Сохраняем кусок
        chunk_path = tmp_dir / f'{idx:06d}.chunk'
        chunk_path.write_bytes(base64.b64decode(chunk_b64))

        # Сохраняем/обновляем мета‑инфу
        meta_path = tmp_dir / 'meta.json'
        if not meta_path.exists():
            meta_path.write_text(json.dumps({
                'file_name': file_name,
                'total_chunks': total,
                'media_type': media_type,
                'uploaded': []
            }))

        meta = json.loads(meta_path.read_text())
        if idx not in meta['uploaded']:
            meta['uploaded'].append(idx)
            meta_path.write_text(json.dumps(meta))

        return Response({'success': True, 'chunk_index': idx})