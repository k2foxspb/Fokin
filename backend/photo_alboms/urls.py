from django.urls import path


from . import views
from .apps import PhotoAlbomsConfig

app_name = PhotoAlbomsConfig.name
urlpatterns = [
    # ... другие ваши URL-адреса ...
    path('', views.photo_view, name='photos'),
    path('album/create/', views.create_album, name='create_album'),
    path('photo/add/<int:album_id>/', views.FileFieldFormView.as_view(), name='add_photo'),
    path('album/<int:album_id>/photo/<int:photo_id>/', views.fullscreen_image_view, name='fullscreen_image'),
    path('<str:username>/albums/', views.user_album_list, name='user_album_list'),

]
