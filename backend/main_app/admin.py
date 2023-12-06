from django.contrib import admin
from main_app import models


@admin.action(description='пометить статью удалённой')
def make_deleted(modeladmin, request, queryset):
    queryset.update(status='del')


@admin.action(description='опубликовать статью')
def make_published(modeladmin, request, queryset):
    queryset.update(status='pu')


@admin.register(models.Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ['title', 'created', 'status']
    search_fields = ['body']
    actions = [make_published, make_deleted]


@admin.register(models.Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['title']
