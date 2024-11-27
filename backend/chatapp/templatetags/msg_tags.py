from django import template
from callbackapp.models import *

register = template.Library()


@register.simple_tag()
def get_room():
    return Msg.objects.all()