from django import forms

from authapp.models import CustomUser
from .models import PhotoAlbum, Photo





class MultipleFileInput(forms.ClearableFileInput):
    allow_multiple_selected = True

class MultipleFileField(forms.FileField):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("widget", MultipleFileInput())
        super().__init__(*args, **kwargs)

    def clean(self, data, initial=None):
        single_file_clean = super().clean
        if isinstance(data, (list, tuple)):
            result = [single_file_clean(d, initial) for d in data]
        else:
            result = [single_file_clean(data, initial)]
        return result

class FileFieldForm(forms.Form):
    file_field = MultipleFileField()

    class Meta:
        model = Photo
        fields = ('image',)

class AlbumForm(forms.ModelForm):
    class Meta:
        model = PhotoAlbum
        fields = ('title','hidden_flag')

