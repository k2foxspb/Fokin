from django.shortcuts import render
from django.views.generic import TemplateView


class NewsView(TemplateView):
    template_name = "news.html"
