from django.urls import path

from users import views

app_name = 'users'

urlpatterns = [
    # path('', views.index, name='index'),
    path('login/', views.login, name='login'),
    path('logout/', views.logout, name='logout'),
    path('register/customer/', views.register_customer, name='register_customer'),
    path('register/restaurant_admin/', views.register_restaurant_admin, name='register_restaurant_admin'),
    path('register/courier/', views.register_courier, name='register_courier'),
    # path('dashboard/customer/', views.customer_dashboard, name='customer_dashboard'),
    # path('dashboard/courier/', views.courier_dashboard, name='courier_dashboard'),
]
