from rest_framework import generics, permissions, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.http import Http404
from authapp.models import CustomUser
from .models import PhotoAlbum, Photo
from .serializers import PhotoAlbumSerializer, PhotoAlbumDetailSerializer, PhotoSerializer


class UserPhotoAlbumsAPIView(generics.ListAPIView):
    """
    API view to retrieve all photo albums for a specific user.
    """
    serializer_class = PhotoAlbumSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        username = self.kwargs.get('username')
        user = get_object_or_404(CustomUser, username=username)
        
        # If requesting own albums, show all including hidden
        if self.request.user == user:
            return PhotoAlbum.objects.filter(user=user).order_by('-created_at')
        else:
            # If requesting other user's albums, only show non-hidden ones
            return PhotoAlbum.objects.filter(user=user, hidden_flag=False).order_by('-created_at')


class PhotoAlbumDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    """
    API view to retrieve, update, or delete a specific photo album.
    """
    serializer_class = PhotoAlbumDetailSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return PhotoAlbum.objects.all()

    def get_object(self):
        album_id = self.kwargs.get('album_id')
        album = get_object_or_404(PhotoAlbum, id=album_id)
        
        # Check permissions: owner can access all albums, others can only access non-hidden
        if self.request.user != album.user and album.hidden_flag:
            raise Http404("Album not found")
        
        return album

    def perform_update(self, serializer):
        # Only allow the owner to update the album
        if self.request.user != self.get_object().user:
            raise permissions.PermissionDenied("You can only edit your own albums")
        serializer.save()

    def perform_destroy(self, instance):
        # Only allow the owner to delete the album
        if self.request.user != instance.user:
            raise permissions.PermissionDenied("You can only delete your own albums")
        instance.delete()


class PhotoDetailAPIView(generics.RetrieveUpdateDestroyAPIView):
    """
    API view to retrieve, update, or delete a specific photo.
    """
    serializer_class = PhotoSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Photo.objects.all()

    def get_object(self):
        photo_id = self.kwargs.get('photo_id')
        photo = get_object_or_404(Photo, id=photo_id)
        
        # Check permissions: owner can access all photos, others can only access photos from non-hidden albums
        if self.request.user != photo.user and photo.album.hidden_flag:
            raise Http404("Photo not found")
        
        return photo

    def perform_update(self, serializer):
        # Only allow the owner to update the photo
        if self.request.user != self.get_object().user:
            raise permissions.PermissionDenied("You can only edit your own photos")
        serializer.save()

    def perform_destroy(self, instance):
        # Only allow the owner to delete the photo
        if self.request.user != instance.user:
            raise permissions.PermissionDenied("You can only delete your own photos")
        instance.delete()


class PhotoAlbumCreateAPIView(generics.CreateAPIView):
    """
    API view to create a new photo album.
    """
    serializer_class = PhotoAlbumSerializer
    permission_classes = [permissions.IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class PhotoCreateAPIView(generics.CreateAPIView):
    serializer_class = PhotoSerializer
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        print("PhotoCreateAPIView.create called")
        print("Request method:", request.method)

        try:
            # Получаем album_id из URL
            album_id = kwargs.get('album_id')  # Изменено с 'pk' на 'album_id'
            print("Album ID from kwargs:", album_id)

            # Проверяем существование альбома
            album = get_object_or_404(PhotoAlbum, pk=album_id)

            # Проверяем права доступа к альбому
            if album.user != request.user:
                return Response(
                    {'error': 'У вас нет прав для добавления фото в этот альбом'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # Создаем новый словарь с данными
            serializer_data = {}

            # Добавляем файл, если он есть
            if 'image' in request.FILES:
                serializer_data['image'] = request.FILES['image']

            # Добавляем подпись, если она есть
            if 'caption' in request.data:
                serializer_data['caption'] = request.data['caption']

            # Добавляем album и user
            serializer_data['album'] = album.id
            serializer_data['user'] = request.user.id

            # Создаем и валидируем сериализатор
            serializer = self.get_serializer(data=serializer_data)
            serializer.is_valid(raise_exception=True)

            # Сохраняем фото
            photo = serializer.save(
                user=request.user,
                album=album
            )

            # Возвращаем ответ
            return Response(
                serializer.data,
                status=status.HTTP_201_CREATED
            )

        except Http404:
            return Response(
                {'error': 'Альбом не найден'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            print("Error in PhotoCreateAPIView.create:", str(e))
            print("Error type:", type(e))
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )