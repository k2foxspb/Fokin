from django.urls import path
from main_app.views import NewsListView

from main_app.apps import MainAppConfig

app_name = MainAppConfig.name

urlpatterns = [
    path('', NewsListView.as_view(), name='main')
]
