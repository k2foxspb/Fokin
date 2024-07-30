from django.contrib.auth import get_user_model, login
from django.contrib.auth.mixins import UserPassesTestMixin
from django.contrib.auth.views import LoginView, PasswordResetView, PasswordResetConfirmView
from django.shortcuts import render
from django.urls import reverse_lazy
from django.views.generic import CreateView, UpdateView, View, TemplateView

from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from authapp import forms
from django.utils.encoding import force_bytes
from django.core.mail import send_mail
from django.shortcuts import redirect
from django.contrib.sites.models import Site
from django.contrib.messages.views import SuccessMessageMixin


class CustomLoginView(LoginView):
    template_name = "login.html"


class RegisterView(CreateView):
    model = get_user_model()
    form_class = forms.CustomUserCreationForm
    success_url = reverse_lazy("main:main_category")
    template_name = "customuser_form.html"
    
    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['title'] = 'Регистрация на сайте'
        return context
    
    def form_valid(self, form):
        # form.send_email()
        user = form.save(commit=False)
        user.is_active = False
        user.save()
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        activation_url = reverse_lazy('authapp:conf_email', kwargs={'uidb64': uid, 'token': token})
        current_site = Site.objects.get_current().domain
        send_mail(
            'Подтвердите свой электронный адрес',
            f'Пожалуйста перейдите по ссылке https://{current_site}{activation_url}',
            'k2foxspb@mail.ru',
            [user.email],
            fail_silently=False,

        )
        return redirect('authapp:email_confirmation_sent')


class ProfileEditView(UserPassesTestMixin, UpdateView):
    model = get_user_model()
    form_class = forms.CustomUserChangeForm
    template_name = "customuser_form.html"
    success_url = reverse_lazy("main:main_category")

    def test_func(self):
        return True if self.request.user.pk == self.kwargs.get("pk") else False
    
    def form_valid(self, form):
        # form.send_email()
        user = form.save(commit=False)
        user.is_active = False
        user.save()
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        activation_url = reverse_lazy('authapp:conf_email', kwargs={'uidb64': uid, 'token': token})
        current_site = Site.objects.get_current().domain
        send_mail(
            'Подтвердите свой электронный адрес',
            f'Пожалуйста перейдите по ссылке https://{current_site}{activation_url}',
            'k2foxspb@mail.ru',
            [user.email],
            fail_silently=False,

        )
        return redirect('authapp:email_confirmation_sent')

    # def get_success_url(self):
    #     return reverse_lazy("authapp:profile_edit", args=[self.request.user.pk])


User = get_user_model()

class ConfirmEmailView(View):
    def get(self, request, uidb64, token, *args, **kwargs):
        try:
            uid = urlsafe_base64_decode(uidb64)
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            user = None
        if user is not None and default_token_generator.check_token(user, token):
            user.is_active = True
            user.save()
            login(request, user)
            return redirect('authapp:email_confirmed')
        else:
            return redirect('authapp:fail_email')
        
class EmailConfirmationSendView(TemplateView):
    template_name = 'registration/email_confirmation_sent.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['title'] = 'Письмо отправлено'
        return context


class EmailConfirmedView(TemplateView):
    template_name = 'registration/email_confirmed.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['title'] = 'Ваш электронный адрес активирован'
        return context


class EmailConfirmationFailedView(TemplateView):
    template_name = 'registration/email_confirmation_failed.html'


class ProfileEditView(UserPassesTestMixin, UpdateView):
    model = get_user_model()
    form_class = forms.CustomUserChangeForm
    success_url = "/success/"

    def form_valid(self, form):
        # form.send_email()
        return super().form_valid(form)

    def test_func(self):
        return True if self.request.user.pk == self.kwargs.get("pk") else False

    def get_success_url(self):
        return reverse_lazy("authapp:profile_edit", args=[self.request.user.pk])


class ResetPasswordView(SuccessMessageMixin, PasswordResetView):
    template_name = 'registration/password_res.html'
    
    email_template_name = 'registration/password_reset_mail.html'
    subject_template_name = 'registration/password_reset_subject.txt'
    success_message = "Мы отправили вам по электронной почте инструкции по установке пароля," \
                      "если существует учетная запись с указанным вами адресом электронной почты." \
                      "Вы должны получить их в ближайшее время." \
                      " Если вы не получили электронное письмо," \
                      "Пожалуйста, убедитесь, что вы ввели адрес, под которым зарегистрировались," \
                      "и проверьте папку со спамом"
    success_url = reverse_lazy('authapp:login')


class ResetPasswordConfirmView(SuccessMessageMixin, PasswordResetConfirmView):
    template_name = 'registration/password_reset_conf.html'
    success_url = reverse_lazy('authapp:Password_reset_comp')


class PrivacyPolicyView(TemplateView):
    template_name = 'registration/Privacy_Policy.html'
