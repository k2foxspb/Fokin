from django.contrib import messages
from django.contrib.auth import get_user_model, login
from django.contrib.auth.mixins import UserPassesTestMixin
from django.contrib.auth.views import LoginView, PasswordResetView, PasswordResetConfirmView, LogoutView
from django.urls import reverse_lazy
from django.utils.safestring import mark_safe
from django.views.generic import CreateView, UpdateView, View, TemplateView

from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from authapp import forms
from django.utils.encoding import force_bytes
from django.core.mail import send_mail
from django.shortcuts import redirect
from django.contrib.sites.models import Site
from django.contrib.messages.views import SuccessMessageMixin


class CustomLoginView(SuccessMessageMixin, LoginView):
    template_name = "login.html"

    def form_valid(self, form):
        ret = super().form_valid(form)
        message = "Успешный вход!<br>Привет, %(username)s" % {
            "username": self.request.user.get_full_name()
            if self.request.user.get_full_name()
            else self.request.user.get_username()
        }
        messages.add_message(self.request, messages.INFO, mark_safe(f'{message}'))
        return ret

    def form_invalid(self, form):
        for _unused, msg in form.error_messages.items():
            messages.add_message(
                self.request,
                messages.WARNING,
                mark_safe(f"{msg}"),
            )
        return self.render_to_response(self.get_context_data(form=form))


class CustomLogoutView(LogoutView):

    def dispatch(self, request, *args, **kwargs):
        messages.add_message(self.request, messages.INFO, "ещё увидимся!)")
        return super().dispatch(request, *args)


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
        # Функция защиты личных данных
        return True if self.request.user.pk == self.kwargs.get("pk") else False

    def form_valid(self, form):
        user = form.save(commit=False)
        user.is_active = True
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


class ResetPasswordView(SuccessMessageMixin, PasswordResetView):
    template_name = 'registration/password_res.html'

    email_template_name = 'registration/passwd_reset_mail.html'
    subject_template_name = 'registration/password_reset_subj.txt'
    success_message = "Мы отправили вам по электронной почте инструкции по установке пароля," \
                      "если существует учетная запись с указанным вами адресом электронной почты." \
                      "Вы должны получить их в ближайшее время." \
                      " Если вы не получили электронное письмо," \
                      "Пожалуйста, убедитесь, что вы ввели адрес, под которым зарегистрировались," \
                      "и проверьте папку со спамом"
    success_url = reverse_lazy('authapp:login')


class ResetPasswordConfirmView(SuccessMessageMixin, PasswordResetConfirmView):
    template_name = 'registration/password_reset_conf.html'
    success_url = reverse_lazy('authapp:password_reset_comp')


class PrivacyPolicyView(TemplateView):
    template_name = 'registration/Privacy_Policy.html'
