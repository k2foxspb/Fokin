from django.urls import path

from main_app.views import (
    ArticleDetailView,
    CategoryListView,
    CategoryDetailView,

)
from main_app.apps import MainAppConfig

app_name = MainAppConfig.name

urlpatterns = [

    path('category/<slug:slug>/', CategoryDetailView.as_view(), name='category_detail'),
    path('', CategoryListView.as_view(), name='main_category'),
    path(
        "article/<slug:slug>/",
        ArticleDetailView.as_view(),
        name="article_detail",
    ),
]
