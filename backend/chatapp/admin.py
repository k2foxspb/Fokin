from django.contrib import admin

from chatapp.models import Room, Message


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    search_fields = ['name']
    fields = ['name']


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    search_fields = ['content']
    fields = ['content']
    ordering = ['timestamp']