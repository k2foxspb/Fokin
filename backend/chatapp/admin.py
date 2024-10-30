from django.contrib import admin

from chatapp.models import Room, Message

admin.site.register(Room)
admin.site.register(Message)