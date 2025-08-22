from django.contrib import admin
from main_app import models
from django.contrib import admin
from .models import Article, Category, Comment, Like


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'status', 'created', 'updated')
    list_filter = ('status', 'category', 'created')
    search_fields = ('title', 'preamble')
    prepopulated_fields = {'slug': ('title',)}
    readonly_fields = ('created', 'updated')


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('title', 'status')
    list_filter = ('status',)
    search_fields = ('title',)
    prepopulated_fields = {'slug': ('title',)}


@admin.register(Comment)
class CommentAdmin(admin.ModelAdmin):
    list_display = ('article', 'author', 'created', 'is_approved')
    list_filter = ('is_approved', 'created')
    search_fields = ('content', 'author__username', 'article__title')
    readonly_fields = ('created', 'updated')
    list_editable = ('is_approved',)


@admin.register(Like)
class LikeAdmin(admin.ModelAdmin):
    list_display = ('article', 'user', 'created')
    list_filter = ('created',)
    search_fields = ('user__username', 'article__title')
    readonly_fields = ('created',)

@admin.action(description='пометить статью удалённой')
def make_deleted(modeladmin, request, queryset):
    queryset.update(status='del')


@admin.action(description='опубликовать статью')
def make_published(modeladmin, request, queryset):
    queryset.update(status='pu')


@admin.register(models.Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ['title', 'created', 'status']
    search_fields = ['title']
    actions = [make_published, make_deleted]
    fields = ['title', 'preamble', 'category', 'content']


@admin.action(description='пометить категорию удалённой')
def make_deleted(modeladmin, request, queryset):
    queryset.update(status='del')


@admin.action(description='опубликовать категорию')
def make_published(modeladmin, request, queryset):
    queryset.update(status='pu')


@admin.register(models.Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ['title']
    actions = [make_published, make_deleted]
