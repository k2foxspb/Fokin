from django.urls import path


from . import views
from .view_api import (
    UserPhotoAlbumsAPIView,
    PhotoAlbumDetailAPIView,
    PhotoDetailAPIView,
)
from .apps import PhotoAlbomsConfig

app_name = PhotoAlbomsConfig.name
urlpatterns = [
    # Template views
    path('', views.photo_list, name='photos'),
    path('<str:username>/', views.photo_list, name='photos_user'),
    path('album/create/', views.create_album, name='create_album'),
    path('photo/add/<int:album_id>/', views.FileFieldFormView.as_view(), name='add_photo'),
    path('album/<int:album_id>/photo/<int:photo_id>/', views.fullscreen_image_view, name='fullscreen_image'),

    # API views
    path('api/user/<str:username>/albums/', UserPhotoAlbumsAPIView.as_view(), name='api_user_albums'),
    path('api/album/<int:album_id>/', PhotoAlbumDetailAPIView.as_view(), name='api_album_detail'),
    path('api/photo/<int:photo_id>/', PhotoDetailAPIView.as_view(), name='api_photo_detail'),
]
