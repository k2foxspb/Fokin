from django.contrib.auth.mixins import PermissionRequiredMixin

from django.urls import reverse_lazy
from django.views.generic import (
    ListView,
    CreateView,
    DetailView,
    UpdateView,
    DeleteView,
    TemplateView,
)
from main_app import models


# class ArticleListView(ListView):
#     model = models.Article
#     paginate_by = 3
#     template_name = 'main/main.html'
#
#     def get_queryset(self):
#         return super().get_queryset().filter(status='pu')


class Main(TemplateView):
    template_name = "main/main.html"


class CategoryListView(ListView):
    model = models.Category
    template_name = "main/articles/category.html"


class CategoryDetailView(DetailView):
    model = models.Category
    template_name = "main/articles/category_detail.html"


class ArticleCreateView(PermissionRequiredMixin, CreateView):
    model = models.Article
    fields = (
        "title",
        "preamble",
        "keyword",
        "category",
        "body",
        "code",
        "image",
        "body1",
        "code1",
        "image1",
        "body2",
        "code2",
        "image2",
        "body3",
        "code3",
        "image3",
        "body4",
        "code4",
        "image4",
        "body5",
        "code5",
        "image5",
        "body6",
        "code6",
        "image6",
        "body7",
        "code7",
        "image7",
        "body8",
        "code8",
        "image8",
        "body9",
        "code9",
        "image9",
        "body10",
        "code10",
        "image10",
    )
    success_url = reverse_lazy("main:main")
    permission_required = ("main_app.add_article",)
    template_name = "main/articles/articles_form.html"


class ArticleDetailView(DetailView):
    model = models.Article
    template_name = "main/articles/articles_detail.html"


class ArticleUpdateView(PermissionRequiredMixin, UpdateView):
    model = models.Article
    fields = (
        "title",
        "preamble",
        "keyword",
        "category",
        "body",
        "code",
        "image",
        "body1",
        "code1",
        "image1",
        "body2",
        "code2",
        "image2",
        "body3",
        "code3",
        "image3",
        "body4",
        "code4",
        "image4",
        "body5",
        "code5",
        "image5",
        "body6",
        "code6",
        "image6",
        "body7",
        "code7",
        "image7",
        "body8",
        "code8",
        "image8",
        "body9",
        "code9",
        "image9",
        "body10",
        "code10",
        "image10",
    )
    success_url = reverse_lazy("main:main_category")
    permission_required = ("main_app.change_article",)
    template_name = "main/articles/articles_form.html"


class ArticleDeleteView(PermissionRequiredMixin, DeleteView):
    model = models.Article
    success_url = reverse_lazy("main:main_category")
    permission_required = ("main_app.delete_article",)
    template_name = "main/articles/articles_confirm_delete.html"
