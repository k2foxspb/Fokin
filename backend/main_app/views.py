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



class About_me(TemplateView):
    template_name = "about_me/about_me.html"


class CategoryListView(ListView):
    model = models.Category
    template_name = "main/articles/category.html"


class CategoryDetailView(DetailView):
    model = models.Category
    template_name = "main/articles/category_detail.html"


class ArticleDetailView(DetailView):
    model = models.Article
    template_name = "main/articles/articles_detail.html"
