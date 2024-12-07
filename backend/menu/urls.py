from django.urls import path

from menu import views

app_name = 'menu'

urlpatterns = [
    path('<slug:restaurant_slug>/', views.menu, name='restaurans_menu'),
    path('<slug:restaurant_slug>/dish-detail/<int:dish_id>/', views.dish_detail, name='dish_detail'),
]
