from django.contrib.auth.models import Permission
from django.shortcuts import render
from django.views.generic import ListView, DetailView

from chatapp.models import Room



class IndexView(ListView, Permission):
    model = Room
    template_name = 'index.html'


# class RoomDetailView(DetailView):
#     def get_context_data(self, **kwargs):
#         context = super().get_context_data(**kwargs)
#         chat_room, created = Room.objects.get_or_create(name=kwargs.room_name)
#         context['chat_room'] = chat_room

def room_view(request, room_name):
    chat_room = Room.objects.get(name=room_name)
    print(type(room_name))
    return render(request, 'room.html', {
        'room': chat_room,
    })