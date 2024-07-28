import os

from django.contrib.auth import get_user_model
from django.contrib.auth.forms import UserCreationForm, UsernameField, UserChangeForm
from django.core.exceptions import ValidationError


class CustomUserCreationForm(UserCreationForm):
    class Meta:
        model = get_user_model()
        fields = (
            "email",
            "username",
            "password1",
            "password2",
            "first_name",
            "last_name",
            "age",
            "avatar",
        )
        field_classes = {"email": UsernameField}


class CustomUserChangeForm(UserChangeForm):
    help_text = "Пароли хранятся в зашифрованном виде,\
     поэтому нет возможности посмотреть пароль)"

    class Meta:
        model = get_user_model()
        fields = (
            "email",
            "username",
            "first_name",
            "last_name",
            "age",
            "avatar",
        )
        field_classes = {"email": UsernameField}

    def clean_avatar(self):
        arg_as_str = "avatar"
        if arg_as_str in self.changed_data and self.instance.avatar:
            if os.path.exists(self.instance.avatar.path):
                os.remove(self.instance.avatar.path)
        return self.cleaned_data.get(arg_as_str)

    def clean_age(self):
        data = self.cleaned_data.get("age")
        if data:
            if data < 18:
                raise ValidationError("нужно немного повзрослеть &#128521;")
            elif data > 90:
                raise ValidationError("Столько не живут &#128519;")
        return data

    # def send_email(self):
    #     """Sends an email when the feedback form has been submitted."""
    #     send_feedback_email_task_update.delay(
    #         self.cleaned_data["email"], self.cleaned_data["first_name"],
    #         self.cleaned_data["last_name"]
    #     )