from django.urls import path

from main_app.views import (
    ArticleDetailView,
    CategoryListView,
    CategoryDetailView, DownloadAppView, App,

)
from main_app.view_api import (
    ArticleListAPIView,
    ArticleDetailAPIView,
    CategoryListAPIView,
    ArticleCommentsAPIView,
    toggle_like_article,
    article_stats,
)
from main_app.apps import MainAppConfig

app_name = MainAppConfig.name

urlpatterns = [
    # Template views
    path('category/<slug:slug>/', CategoryDetailView.as_view(), name='category_detail'),
    path('', App.as_view(), name='main_category'),
    path('mobile_app', DownloadAppView.as_view(), name='mobile_app'),
    path(
        "article/<slug:slug>/",
        ArticleDetailView.as_view(),
        name="article_detail",
    ),

    # API views
    path('api/articles/', ArticleListAPIView.as_view(), name='api_articles_list'),
    path('api/articles/<slug:slug>/', ArticleDetailAPIView.as_view(), name='api_article_detail'),
    path('api/categories/', CategoryListAPIView.as_view(), name='api_categories_list'),

    # Comments and Likes API
    path('api/articles/<slug:slug>/comments/', ArticleCommentsAPIView.as_view(), name='api_article_comments'),
    path('api/articles/<slug:slug>/like/', toggle_like_article, name='api_toggle_like'),
    path('api/articles/<slug:slug>/stats/', article_stats, name='api_article_stats'),
]
