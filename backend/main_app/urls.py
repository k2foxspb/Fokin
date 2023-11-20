from django.urls import path

from main_app.views import ArticleCreateView, ArticleDetailView, ArticleUpdateView, ArticleDeleteView, \
    CategoryListView

from main_app.apps import MainAppConfig

app_name = MainAppConfig.name

urlpatterns = [
    # path('r', ArticleListView.as_view(), name='main'),
    path('', CategoryListView.as_view(), name='main_category'),
    path("article/create/", ArticleCreateView.as_view(), name="article_create"),
    path(
        "article/<slug:slug>/",
        ArticleDetailView.as_view(),
        name="article_detail",
    ),
    path(
        "article/<slug:slug>/update",
        ArticleUpdateView.as_view(),
        name="article_update",
    ),
    path(
        "article/<slug:slug>/delete",
        ArticleDeleteView.as_view(),
        name="article_delete",
    ),
]
