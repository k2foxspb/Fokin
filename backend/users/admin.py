from django.contrib import admin
from .models import CustomUserr


# Register your models here.

@admin.register(CustomUserr)
class UserAdmin(admin.ModelAdmin):
    list_display = ['username','first_name', 'last_name']
    search_fields = ['username', 'first_name', 'last_name']
    # inlines = [RestauransTabAdmin, ]
