import os

from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm, UsernameField, UserChangeForm
from .tasks import send_feedback_email_task_update, send_feedback_email_task


class CustomUserCreationForm(UserCreationForm):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        password_field = self.fields.get('password')
        if password_field:
            if self.instance.pk:  # Проверяем, существует ли уже экземпляр
                password_field.help_text = "Пароли хранятся в зашифрованном виде,\
        поэтому нет возможности посмотреть пароль)"
                password_field.widget.attrs['class'] = 'form-control'
        for field_name in self.fields:
            if field_name != 'password':  # Исключаем поле пароля, для него класс уже задан
                self.fields[field_name].widget.attrs['class'] = '.form-control'

    def send_email(self):
        """Sends an email when the feedback form has been submitted."""
        send_feedback_email_task.delay(
            self.cleaned_data["email"], self.cleaned_data["first_name"],
            self.cleaned_data["last_name"]
        )

    class Meta:
        model = get_user_model()
        fields = (
            "email",
            "username",
            "password1",
            "password2",
            "first_name",
            "last_name",
            "gender",
            "age",
            "avatar",
        )
        field_classes = {"email": UsernameField}


class CustomUserChangeForm(UserChangeForm):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        password_field = self.fields.get('password')
        if password_field:
            if self.instance.pk:  # Проверяем, существует ли уже экземпляр
                password_field.help_text = "Пароли хранятся в зашифрованном виде,\
     поэтому нет возможности посмотреть пароль"
                password_field.widget.attrs['class'] = 'password-form-control'
        for field_name in self.fields:
            if field_name != 'password':  # Исключаем поле пароля, для него класс уже задан
                self.fields[field_name].widget.attrs['class'] = 'form-control'

    class Meta:
        model = get_user_model()
        fields = (
            "email",
            "username",
            "first_name",
            "last_name",
            "gender",
            "age",
            "avatar",
        )
        field_classes = {"email": UsernameField}

    # def clean_avatar(self):
    #     arg_as_str = "avatar"
    #     if arg_as_str in self.changed_data and self.instance.avatar:
    #         if os.path.exists(self.instance.avatar.path):
    #             os.remove(self.instance.avatar.path)
    #     return self.cleaned_data.get(arg_as_str)



    def send_email(self):
        """Sends an email when the feedback form has been submitted."""
        send_feedback_email_task_update.delay(
            self.cleaned_data["email"], self.cleaned_data["first_name"],
            self.cleaned_data["last_name"]
        )
