from django.views.generic import ListView
from main_app import models


class NewsListView(ListView):
    model = models.News
    paginate_by = 3
    template_name = 'main/main.html'
