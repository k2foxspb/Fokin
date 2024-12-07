from django import forms
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm

from users.models import CustomUser


class UserLoginForm(AuthenticationForm):
    username = forms.CharField()
    password = forms.CharField()

    class Meta:
        model = CustomUser
        fields = ['username', 'password']

class CustomerRegistrationForm(UserCreationForm):

    first_name = forms.CharField()
    last_name = forms.CharField()
    username = forms.CharField()
    email = forms.CharField()
    password1 = forms.CharField()
    password2 = forms.CharField()

    class Meta:
        model = CustomUser
        fields = ['first_name',
                  'last_name',
                  'username',
                  'email',
                  'password1',
                  'password2'
                  ]

    def save(self, commit=True):
        user = super().save(commit=False)
        user.role = 'customer'  # Устанавливаем роль покупателя
        if commit:
            user.save()
        return user

class RestaurantAdminRegistrationForm(UserCreationForm):
    class Meta:
        model = CustomUser
        fields = ['username', 'password1', 'password2']

    def save(self, commit=True):
        user = super().save(commit=False)
        user.role = 'restaurant_admin'  # Устанавливаем роль администратора ресторана
        if commit:
            user.save()
        return user


class CourierRegistrationForm(UserCreationForm):
    class Meta:
        model = CustomUser
        fields = ['first_name',
                  'last_name',
                  'username',
                  'email',
                  'password1',
                  'password2'
                  ]

    def save(self, commit=True):
        user = super().save(commit=False)
        user.role = 'courier'  # Устанавливаем роль курьера
        if commit:
            user.save()
        return user