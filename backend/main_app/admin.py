from django.contrib import admin
from .models import Article, Category, Comment, Like


@admin.action(description='пометить статью удалённой')
def make_article_deleted(modeladmin, request, queryset):
    queryset.update(status='del')


@admin.action(description='опубликовать статью')
def make_article_published(modeladmin, request, queryset):
    queryset.update(status='pu')


@admin.action(description='пометить категорию удалённой')
def make_category_deleted(modeladmin, request, queryset):
    queryset.update(status='del')


@admin.action(description='опубликовать категорию')
def make_category_published(modeladmin, request, queryset):
    queryset.update(status='pu')


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ('title', 'category', 'status', 'created', 'updated')
    list_filter = ('status', 'category', 'created')
    search_fields = ('title', 'preamble')
    prepopulated_fields = {'title': ('title',)}
    readonly_fields = ('created', 'updated')
    actions = [make_article_published, make_article_deleted]
    fields = ['title', 'preamble', 'category', 'content']


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ('title', 'status')
    list_filter = ('status',)
    search_fields = ('title',)
    prepopulated_fields = {'title': ('title',)}
    actions = [make_category_published, make_category_deleted]


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
