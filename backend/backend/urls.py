"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include

from backend import settings
from django.conf.urls.static import static

urlpatterns = [
    path("ckeditor5/", include('django_ckeditor_5.urls')),
    path('comments/', include('django_comments.urls')),
    path('admin/', admin.site.urls),
    path('', include('main_app.urls', namespace='main')),
    path('authentication/', include('authapp.urls', namespace='auth')),
    path('chat/', include('chatapp.urls', namespace='chat')),
    path('photo/', include('photo_alboms.urls', namespace='photo')),
    path('profile/', include('profileapp.urls', namespace='profile')),
    path('media-api/', include('media_api.urls', namespace='media_api')),
]
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
