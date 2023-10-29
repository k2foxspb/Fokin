from django.contrib import admin
from main_app import models


@admin.register(models.Article)
class ArticleAdmin(admin.ModelAdmin):
    search_fields = ['title']
