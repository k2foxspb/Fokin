import re

from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Max, Count, Q, F, Subquery, OuterRef, IntegerField
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from django.views.generic import ListView

from authapp.models import CustomUser
from chatapp.models import Room, PrivateChatRoom, UserChat, PrivateMessage


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
def get_chat_history(request, room_id):
    room = PrivateChatRoom.objects.get(pk=room_id)
    if request.user != room.user1 and request.user != room.user2:
        return JsonResponse({'error': 'Unauthorized access'}, status=403)

    messages = PrivateMessage.objects.filter(room=room).order_by('timestamp').values('sender__username', 'message',
                                                                                     'timestamp')
    messages_list = [{**m, 'timestamp': int(m['timestamp'].timestamp())} for m in list(messages)]
    return JsonResponse({'messages': messages_list})


@login_required(login_url='auth:login')
def user_dialog_list(request):
    unread_message_count_subquery = Subquery(
        PrivateMessage.objects.filter(
            room_id=OuterRef('chat_room__id'),
            is_read=False,
        ).exclude(sender_id=request.user.id).values('room_id').annotate(count=Count('id')).values('count')[:1],
        output_field=IntegerField()
    )

    user_chats = UserChat.objects.filter(
        Q(chat_room__user1=request.user) | Q(chat_room__user2=request.user)  # Изменено условие фильтрации
    ) \
        .select_related('chat_room', 'last_message__sender') \
        .annotate(
        room_id=F('chat_room__id'),
        last_message_time=Max('chat_room__messages__timestamp'),
        last_message_text=Max('chat_room__messages__message'),
        unread_message_count=unread_message_count_subquery
    ) \
        .order_by('-last_message_time')

    context = {
        'dialogs': [{
            'id': chat.room_id,
            'other_user': chat.chat_room.user1 if chat.chat_room.user2 == request.user else chat.chat_room.user2,
            'last_message': chat.last_message_text if chat.last_message_text else 'Нет сообщений',
            'last_message_time': chat.last_message_time.strftime(
                '%Y-%m-%d %H:%M') if chat.last_message_time else 'Нет сообщений',
            'unread_count': chat.unread_message_count if chat.unread_message_count is not None else 0,
            'other_user_username': (
                chat.chat_room.user1 if chat.chat_room.user2 == request.user else chat.chat_room.user2).username,
        } for chat in user_chats]
    }

    return render(request, 'user_dialogs.html', context)
