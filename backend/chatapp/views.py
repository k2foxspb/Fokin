import re

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import Permission
from django.core.exceptions import ObjectDoesNotExist
from django.http import JsonResponse
from django.shortcuts import render
from django.views.generic import ListView, DetailView

from authapp.models import CustomUser
from chatapp.models import Room, PrivateChatRoom


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


def get_private_room(request, username1, username2):
    try:
        user1 = CustomUser.objects.get(username=username1)
        user2 = CustomUser.objects.get(username=username2)

        room, created = PrivateChatRoom.objects.get_or_create(
            user1=user1, user2=user2
        )
        print(user1.id, user2.id)
        return JsonResponse({
            'user1_id': user1.id,
            'user2_id': user2.id,
            'room_name': room.room_name,
        })

    except ObjectDoesNotExist:
        return JsonResponse({'error': 'One or both users not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def private_chat_view(request, room_name):
    try:
        match = re.match(r"private_chat_(\d+)_(\d+)", room_name)
        if match:
            user1_id = int(match.group(1))
            user2_id = int(match.group(2))
            return render(request, 'private_message.html', {
                'room_name': room_name,
                'user1_id': user1_id,
                'user2_id': user2_id,
                'username': request.user.username,
            })
        return render(request, 'private_message.html', {'room_name': room_name})
    except PrivateChatRoom.DoesNotExist:
        return render(request, 'index.html', {'message': 'Room not found'})
