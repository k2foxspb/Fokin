from django import template
from main_app.models import *

register = template.Library()


@register.simple_tag()
def get_category():
    return Category.objects.all()


@register.simple_tag()
def get_article():
    return Article.objects.filter(status='pu')
