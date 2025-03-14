from django.urls import path


from . import views
from .apps import PhotoAlbomsConfig

app_name = PhotoAlbomsConfig.name
urlpatterns = [
    # ... другие ваши URL-адреса ...
    path('profile/', views.profile_view, name='profile'),
    path('profile/album/create/', views.create_album, name='create_album'),
    path('profile/photo/add/<int:album_id>/', views.FileFieldFormView.as_view(), name='add_photo'),
    path('profile/album/<int:album_id>/photo/<int:photo_id>/', views.fullscreen_image_view, name='fullscreen_image'),
    # ... другие ваши URL-адреса ...
]
