from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser
from django.shortcuts import get_object_or_404
from django.http import Http404

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

    def get(self, request, file_id, *args, **kwargs):
        try:
            # Получаем файл по ID
            uploaded_file = get_object_or_404(UploadedFile, id=file_id)

            # Проверяем права доступа (файл должен принадлежать пользователю или быть частью чата, к которому у пользователя есть доступ)
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
