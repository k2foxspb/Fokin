import re

from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Max, Count, Q, F, Subquery, OuterRef, IntegerField, Case, When, CharField
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.generic import ListView

from authapp.models import CustomUser
from chatapp.models import Room, PrivateChatRoom, PrivateMessage


class IndexView(ListView, LoginRequiredMixin):
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

        room = PrivateChatRoom.objects.get(
            Q(user1=user1, user2=user2) | Q(user1=user2, user2=user1)
        )
        return JsonResponse({
            'user1_id': user1.id,
            'user2_id': user2.id,
            'room_name': room.pk,
        })

    except PrivateChatRoom.DoesNotExist:
        room, created = PrivateChatRoom.objects.get_or_create(user1=user1, user2=user2) #Создаём если не существует
        return JsonResponse({
            'user1_id': user1.id,
            'user2_id': user2.id,
            'room_name': room.pk,
        })
    except CustomUser.DoesNotExist:
        return JsonResponse({'error': 'One or both users not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required(login_url='auth:login')
def private_chat_view(request, room_id):
    try:
        room = PrivateChatRoom.objects.get(pk=room_id)
        if request.user != room.user1 and request.user != room.user2:
            return JsonResponse({'error': 'Unauthorized access'}, status=403)

        recipient = room.user1 if request.user == room.user2 else room.user2
        return render(request, 'private_message.html', {
            'room': room,  # Передаем объект room
            'user1_id': room.user1.id,
            'user2_id': room.user2.id,
            'username': request.user.username,
            'recipient': recipient,
        })
    except PrivateChatRoom.DoesNotExist:
        return render(request, 'index.html', {'message': 'Room not found'})




@login_required(login_url='auth:login')
def get_chat_history(request, room_id):
    room = PrivateChatRoom.objects.get(pk=room_id)
    if request.user != room.user1 and request.user != room.user2:
        return JsonResponse({'error': 'Unauthorized access'}, status=403)

    from .models import MessageDeletion

    # Получаем ID сообщений, которые пользователь удалил для себя
    user_deleted_message_ids = MessageDeletion.objects.filter(
        user=request.user
    ).values_list('message_id', flat=True)

    # Фильтруем сообщения: исключаем глобально удаленные и пользовательские удаления
    messages = PrivateMessage.objects.filter(
        room=room
    ).exclude(
        Q(is_deleted=True) |  # Глобально удаленные сообщения
        Q(id__in=user_deleted_message_ids)  # Сообщения, удаленные пользователем для себя
    ).order_by('timestamp').values(
        'id', 'sender__username', 'sender_id', 'message', 'timestamp',
        'media_type', 'media_hash', 'media_filename', 'media_size'
    )

    # Добавляем информацию о медиа для совместимости с фронтендом
    messages_list = []
    for m in messages:
        message_data = {
            **m, 
            'timestamp': int(m['timestamp'].timestamp()),
            # Добавляем поля для совместимости с фронтендом
            'mediaType': m['media_type'] if m['media_type'] != 'text' else None,
            'mediaHash': m['media_hash'],
            'mediaFileName': m['media_filename'], 
            'mediaSize': m['media_size'],
        }
        messages_list.append(message_data)

    return JsonResponse({'messages': messages_list})


@login_required(login_url='auth:login')
def user_dialog_list(request):
    user = request.user

    # Подзапрос для последнего времени сообщения
    last_message_time_subquery = Subquery(
        PrivateMessage.objects.filter(
            room=OuterRef('room')
        ).order_by('-timestamp')[:1].values('timestamp')
    )

    # Подзапрос для последнего сообщения
    last_message_text_subquery = Subquery(
        PrivateMessage.objects.filter(
            room=OuterRef('room')
        ).order_by('-timestamp')[:1].values('message')
    )


    user_dialogs = PrivateMessage.objects.filter(
        Q(sender=user) | Q(recipient=user)
    ).values('room', 'sender', 'recipient').annotate(
        other_user_id=Case(
            When(sender=user, then=F('recipient_id')),
            When(recipient=user, then=F('sender_id')),
            output_field=IntegerField()
        ),
        last_message_time=last_message_time_subquery,
        last_message=last_message_text_subquery
    ).order_by('-last_message_time').values('other_user_id', 'room', 'last_message_time', 'last_message').distinct()


    context = {
        'dialogs': [
            {
                'id': chat['room'],
                'other_user': CustomUser.objects.get(id=chat['other_user_id']),
                'last_message_time': chat['last_message_time'],
                'last_message': chat['last_message'],
                'other_user_username': CustomUser.objects.get(id=chat['other_user_id']).username
            } for chat in user_dialogs
        ]
    }

    return render(request, 'user_dialogs.html', context)