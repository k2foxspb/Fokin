from django.urls import path
from news.apps import NewsConfig
from news.views import NewsView

app_name = NewsConfig.name

urlpatterns = [
    path('', NewsView.as_view(), name='news'),
]


