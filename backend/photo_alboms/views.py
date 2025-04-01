from django.contrib.auth import get_user_model
from django.http import HttpResponseForbidden, Http404, HttpResponseNotFound
from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.urls import reverse_lazy, reverse
from django.views.generic import FormView

from authapp.models import CustomUser
from .models import PhotoAlbum, Photo
from .forms import AlbumForm, FileFieldForm

@login_required(login_url='auth:login')
def photo_list(request):
    username = request.GET.get('username')

    if username:
        try:
            user = get_object_or_404(get_user_model(), username=username)
            if request.user.is_authenticated:  # Проверка авторизации
                if request.user == user or request.user.is_superuser:
                    albums = user.albums.all()
                else:
                    albums = user.albums.filter(hidden_flag=False)
                context = {'albums': albums, 'user': user, 'is_authenticated': request.user.is_authenticated,
                           'username': request.user.username}
            else:
                albums = user.albums.filter(hidden_flag=False)  # Только публичные и не скрытые
                context = {'albums': albums, 'user': user, 'is_authenticated': False}

        except Http404:
            return HttpResponseNotFound("Пользователь не найден")
    else:
        if request.user.is_authenticated:
            albums = PhotoAlbum.objects.filter(user=request.user)
            context = {'albums': albums, 'user': request.user, 'is_authenticated': True}
        else:
            albums = PhotoAlbum.objects.filter(hidden_flag=False)  # Только публичные и не скрытые
            context = {'albums': albums, 'user': None, 'is_authenticated': False}

    return render(request, 'photo.html', context)


def create_album(request):
    if request.method == 'POST':
        form = AlbumForm(request.POST)
        if form.is_valid():
            album = form.save(commit=False)
            album.user = request.user
            album.save()
            return redirect('photos')  # или другой URL
    else:
        form = AlbumForm()
    return render(request, 'create_album.html', {'form': form})


class FileFieldFormView(FormView):
    form_class = FileFieldForm
    template_name = "add_photo.html"
    success_url = reverse_lazy('photo:photos')  # Изменено: указывает на профиль

    def form_valid(self, form):
        album = get_object_or_404(PhotoAlbum, id=self.kwargs['album_id'], user=self.request.user)
        files = form.cleaned_data["file_field"]
        for f in files:
            Photo.objects.create(image=f, album=album, user=self.request.user)
        return super().form_valid(form)


def fullscreen_image_view(request, album_id, photo_id):
    album = get_object_or_404(PhotoAlbum, pk=album_id)
    photo = get_object_or_404(Photo, pk=photo_id, album=album)

    next_photo = photo.get_next_photo()
    prev_photo = photo.get_previous_photo()

    context = {
        'photo_url': photo.image.url,
        'album': album,
        'photo': photo,
        'next_photo_id': next_photo.id if next_photo else None,
        'prev_photo_id': prev_photo.id if prev_photo else None,
        'album_id': album_id,
    }
    if request.method == 'POST':
        if 'delete' in request.POST:
            photo.delete()
            if next_photo:
                return redirect('photo:fullscreen_image', album_id=album_id, photo_id=next_photo.id)
            elif prev_photo:
                return redirect('photo:fullscreen_image', album_id=album_id, photo_id=prev_photo.id)
            else:
                return redirect('profile:profile', username=album.user.username)
        elif request.POST.get('next') and next_photo:
            return redirect('photo:fullscreen_image', album_id=album_id, photo_id=next_photo.id)
        elif request.POST.get('prev') and prev_photo:
            return redirect('photo:fullscreen_image', album_id=album_id, photo_id=prev_photo.id)

    return render(request, 'fullscreen_image.html', context)
