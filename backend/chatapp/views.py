import re

from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import Permission
from django.core.exceptions import ObjectDoesNotExist
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.generic import ListView

from authapp.models import CustomUser
from chatapp.models import Room, PrivateChatRoom, UserChat, PrivateMessage



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


@login_required(login_url='auth:login')
def private_chat_view(request, room_name):
    try:
        match = re.match(r"private_chat_(\d+)_(\d+)", room_name)
        if match:
            user1_id = int(match.group(1))
            user2_id = int(match.group(2))
            if request.user.id != user1_id and request.user.id != user2_id:
                return JsonResponse({'error': 'Unauthorized access'}, status=403)
            if request.user.id == user1_id:
                recipient = CustomUser.objects.get(id=user2_id)

            else:
                recipient = CustomUser.objects.get(id=user1_id)


            return render(request, 'private_message.html', {
                'room_name': room_name,
                'user1_id': user1_id,
                'user2_id': user2_id,
                'username': request.user.username,
                'recipient': recipient,
            })
        return render(request, 'private_message.html', {'room_name': room_name})
    except PrivateChatRoom.DoesNotExist:
        return render(request, 'index.html', {'message': 'Room not found'})


@login_required(login_url='auth:login')
def user_chats(request):
    user_chats = UserChat.objects.filter(user=request.user).select_related('chat_room').prefetch_related(
        'last_message__sender')
    chat_data = [{
        'id': chat.chat_room.id,
        'user2_id': chat.chat_room.user2.id if chat.chat_room.user1_id == request.user.id else chat.chat_room.user1.id,
        'user2': chat.chat_room.user2.username if chat.chat_room.user1_id == request.user.id else chat.chat_room.user1.username,
        'last_message': chat.last_message.message if chat.last_message else '',
        'last_message_time': chat.last_message.timestamp if chat.last_message else '',
        'unread_count': chat.unread_count,
    } for chat in user_chats]
    return JsonResponse(chat_data, safe=False)


@receiver(post_save, sender=PrivateMessage)
def update_unread_count(sender, instance, created, **kwargs):
    if created:
        user = instance.room.user1 if instance.room.user2 == instance.sender else instance.room.user2
        user_chat, created = UserChat.objects.get_or_create(chat_room=instance.room, user=user)
        user_chat.unread_count += 1
        user_chat.last_message = instance
        user_chat.save()


@login_required(login_url='auth:login')
def get_chat_history(request, room_name):
    match = re.match(r"private_chat_(\d+)_(\d+)", room_name)
    if match:
        user1_id = int(match.group(1))
        user2_id = int(match.group(2))
    user = CustomUser.objects.get(pk=user2_id)
    room = get_object_or_404(PrivateChatRoom, user1=user1_id, user2=user2_id)
    messages = PrivateMessage.objects.filter(room=room).order_by('timestamp').values('sender__username', 'message',
                                                                                     'timestamp')

    if request.user.id != user1_id and request.user.id != user2_id:
        return JsonResponse({'error': 'Unauthorized access'}, status=403)
    messages_list = [{**m, 'timestamp': int(m['timestamp'].timestamp())} for m in list(messages)]
    return JsonResponse({'messages': messages_list, 'unread_count': user.chats.get(chat_room=room).unread_count})
