from django.contrib import admin
from .models import CustomUser


# Register your models here.

@admin.register(CustomUser)
class UserAdmin(admin.ModelAdmin):
    list_display = ['username','first_name', 'last_name']
    search_fields = ['username', 'first_name', 'last_name']
    # inlines = [RestauransTabAdmin, ]
