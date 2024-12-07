from django.urls import path

from main import views

app_name = 'main'

urlpatterns = [
    path('', views.index, name='index'),
    path('search/', views.index, name='search'),
    path('promotion-detail/<int:promo_id>/', views.promotion_detail, name='promotion_detail'),
    path('cart/', views.cart_detail, name='cart_detail'),
    path('about/', views.about, name='about'),
    path('<slug:category_slug>/', views.index, name='index'),
]
