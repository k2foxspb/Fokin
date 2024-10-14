from pathlib import Path
from time import time


from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin, UserManager
from django.contrib.auth.validators import ASCIIUsernameValidator
from django.db import models



def users_avatars_path(instance, filename):
    # file will be uploaded to
    #   MEDIA_ROOT / user_<username> / avatars / <filename>
    num = int(time() * 1000)
    suf = Path(filename).suffix
    return f"user_{instance.username}/avatars/pic_{num}{suf}"


class CustomUser(AbstractBaseUser, PermissionsMixin):
    username_validator = ASCIIUsernameValidator()

    username = models.CharField(
        "Логин",
        max_length=35,
        unique=True,
        help_text="не более 35 символов. Только буквы, цифры и @/./+/-/_.",
        validators=[username_validator],
        error_messages={'error': "Пользователь с таким именем уже существует"},
    )
    first_name = models.CharField("Имя", max_length=150, blank=True)
    last_name = models.CharField("Фамилия", max_length=150, blank=True)
    age = models.PositiveIntegerField("Возраст", blank=True, null=True)
    avatar = models.ImageField(
        "Ваше фото", upload_to=users_avatars_path, blank=True, null=True
    )
    email = models.CharField(
        "адрес электронной почты",
        max_length=256,
        unique=True,
        error_messages={
            'error': "Пользователь с таким адресом электронной почты уже существует.",
        },
    )
    is_staff = models.BooleanField(
        "статус администратора",
        default=False,
        help_text="Определяет, может ли пользователь войти в панель администратора.",
    )

    is_active = models.BooleanField(
        "Активен",
        default=True,
        help_text="Определяет, следует ли считать этого пользователя активным. \
            Снимите этот флажок вместо удаления учетных записей.",
    )
    date_joined = models.DateTimeField("Дата регистрации", auto_now_add=True)
    objects = UserManager()
    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    class Meta:
        verbose_name = "Пользователь"
        verbose_name_plural = "Пользователи"

    def get_full_name(self):
        full_name = "%s %s" % (self.first_name, self.last_name)
        return full_name.strip()
