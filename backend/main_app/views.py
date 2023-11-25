from django.contrib.auth.mixins import PermissionRequiredMixin
from django.urls import reverse_lazy
from django.views.generic import ListView, CreateView, DetailView, UpdateView, DeleteView
from main_app import models


# class ArticleListView(ListView):
#     model = models.Article
#     paginate_by = 3
#     template_name = 'main/main.html'
#
#     def get_queryset(self):
#         return super().get_queryset().filter(status='pu')


class CategoryListView(ListView):
    model = models.Category
    template_name = 'main/articles/category.html'


class ArticleCreateView(PermissionRequiredMixin, CreateView):
    model = models.Article
    fields = ('title', 'preamble', 'body', 'keyword', 'category', 'image')
    success_url = reverse_lazy("main:main")
    permission_required = ('main_app.add_article',)
    template_name = 'main/articles/articles_form.html'


class ArticleDetailView(DetailView):
    model = models.Article
    template_name = 'main/articles/articles_detail.html'


class ArticleUpdateView(PermissionRequiredMixin, UpdateView):
    model = models.Article
    fields = ('title', 'preamble', 'body', 'keyword', 'category', 'image')
    success_url = reverse_lazy("main:main_category")
    permission_required = ("main_app.change_article",)
    template_name = 'main/articles/articles_form.html'


class ArticleDeleteView(PermissionRequiredMixin, DeleteView):
    model = models.Article
    success_url = reverse_lazy("main:main_category")
    permission_required = ("main_app.delete_article",)
    template_name = 'main/articles/articles_confirm_delete.html'
