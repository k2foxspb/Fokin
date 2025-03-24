from django.urls import path


from . import views
from .apps import PhotoAlbomsConfig

app_name = PhotoAlbomsConfig.name
urlpatterns = [
    # ... другие ваши URL-адреса ...
    path('<str:username>/', views.photo_list, name='photos'),
    path('album/create/', views.create_album, name='create_album'),
    path('photo/add/<int:album_id>/', views.FileFieldFormView.as_view(), name='add_photo'),
    path('album/<int:album_id>/photo/<int:photo_id>/', views.fullscreen_image_view, name='fullscreen_image'),


]
