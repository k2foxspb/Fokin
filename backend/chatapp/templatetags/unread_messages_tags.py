from django import template
from authapp.models import CustomUser
from django.db.models import  Q
from chatapp.models import PrivateMessage

register = template.Library()


@register.simple_tag(takes_context=True)
def unread_message_count(context):
    request = context['request']
    if request.user.is_authenticated:
        unread_count = PrivateMessage.objects.filter(
            Q(room__user1=request.user) | Q(room__user2=request.user),
            read=False,
        ).exclude(sender=request.user).count()
        return unread_count
    else:
        return 0
