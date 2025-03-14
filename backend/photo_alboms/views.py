from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.urls import reverse_lazy
from django.views.generic import FormView

from authapp.forms import CustomUserChangeForm
from .models import PhotoAlbum, Photo
from .forms import AlbumForm, FileFieldForm


@login_required
def profile_view(request):
    albums = PhotoAlbum.objects.filter(user=request.user).prefetch_related('photos')
    return render(request, 'profile.html', {'albums': albums})
@login_required
def create_album(request):
    if request.method == 'POST':
        form = AlbumForm(request.POST)
        if form.is_valid():
            album = form.save(commit=False)
            album.user = request.user
            album.save()
            return redirect('photo_alboms:profile')
    else:
        form = AlbumForm()
    return render(request, 'create_album.html', {'form': form})


class FileFieldFormView(FormView):
    form_class = FileFieldForm
    template_name = "add_photo.html"  # Replace with your template.
    success_url = reverse_lazy('personal:profile')  # Replace with your URL or reverse().

    def form_valid(self, form):
        album = get_object_or_404(PhotoAlbum, id= self.kwargs['album_id'], user=self.request.user)
        files = form.cleaned_data["file_field"]
        for f in files:
            Photo.objects.create(image=f, album=album)
        return super().form_valid(form)


def fullscreen_image_view(request, album_id, photo_id):
    album = get_object_or_404(PhotoAlbum, pk=album_id)
    photo = get_object_or_404(Photo, pk=photo_id, album=album) #Проверка, что фото принадлежит альбому

    #Получаем все фотографии из альбома
    photos_in_album = album.photos.all()
    photo_urls = [p.image.url for p in photos_in_album]
    current_photo_index = list(photo_urls).index(photo.image.url)

    context = {
        'photo_url': photo.image.url,
        'photo_urls': photo_urls,
        'current_photo_index': current_photo_index,
        'album_id': album_id, #Для возврата к списку
    }
    return render(request, 'fullscreen_image.html', context)
