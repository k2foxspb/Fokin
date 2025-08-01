from django.urls import path

from main_app.views import (
    ArticleDetailView,
    CategoryListView,
    CategoryDetailView,

)
from main_app.view_api import (
    ArticleListAPIView,
    ArticleDetailAPIView,
    CategoryListAPIView,
)
from main_app.apps import MainAppConfig

app_name = MainAppConfig.name

urlpatterns = [
    # Template views
    path('category/<slug:slug>/', CategoryDetailView.as_view(), name='category_detail'),
    path('', CategoryListView.as_view(), name='main_category'),
    path(
        "article/<slug:slug>/",
        ArticleDetailView.as_view(),
        name="article_detail",
    ),

    # API views
    path('api/articles/', ArticleListAPIView.as_view(), name='api_articles_list'),
    path('api/articles/<slug:slug>/', ArticleDetailAPIView.as_view(), name='api_article_detail'),
    path('api/categories/', CategoryListAPIView.as_view(), name='api_categories_list'),
]
