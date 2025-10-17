import os
from django.conf import settings
from django.http import FileResponse, Http404
from django.views import View

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

class CategoryListView(ListView):
    model = models.Category
    template_name = "main/articles/category.html"


class CategoryDetailView(DetailView):
    model = models.Category
    template_name = "main/articles/category_detail.html"


class ArticleDetailView(DetailView):
    model = models.Article
    template_name = "main/articles/articles_detail.html"

class App(TemplateView):
    template_name = "main/articles/download_app.html"

class DownloadAppView(View):
    """
    Возвращает файл мобильного приложения для скачивания.
    Ожидается, что файл `mobile_app.apk` находится в директории
    <project_root>/static/ (или в любой другой директории, указанной в settings.BASE_DIR).
    """
    def get(self, request, *args, **kwargs):
        file_path = os.path.join(settings.BASE_DIR, 'static', 'mobile_app.apk')
        if not os.path.exists(file_path):
            raise Http404("Файл мобильного приложения не найден.")
        return FileResponse(open(file_path, 'rb'), as_attachment=True, filename='mobile_app.apk')
