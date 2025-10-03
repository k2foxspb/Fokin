from django.urls import path
from . import views

app_name = 'media_api'

urlpatterns = [
    path('upload/image/', views.ImageUploadView.as_view(), name='upload-image'),
    path('upload/video/', views.VideoUploadView.as_view(), name='upload-video'),
    path('upload/file/', views.FileUploadView.as_view(), name='upload-file'),
    path('delete/<int:file_id>/', views.DeleteFileView.as_view(), name='delete-file'),
    path('files/', views.UserFilesListView.as_view(), name='user-files'),
    path('message/<int:message_id>/url/', views.MessageMediaUrlView.as_view(), name='message-media-url'),
]
