from django.contrib.auth import get_user_model
from django.contrib.auth.mixins import UserPassesTestMixin
from django.contrib.auth.views import LoginView
from django.shortcuts import render
from django.urls import reverse_lazy
from django.views.generic import CreateView, UpdateView

from authapp import forms


class CustomLoginView(LoginView):
    template_name = "login.html"


class RegisterView(CreateView):
    model = get_user_model()
    form_class = forms.CustomUserCreationForm
    success_url = reverse_lazy("main:main")
    template_name = 'customuser_form.html'


class ProfileEditView(UserPassesTestMixin, UpdateView):
    model = get_user_model()
    form_class = forms.CustomUserChangeForm

    # def get_success_url(self):
    #     return reverse_lazy("authapp:profile_edit", args=[self.request.user.pk])
