import os
from pathlib import Path
from time import time

from django.conf import settings
from django.contrib.auth.base_user import AbstractBaseUser
from django.contrib.auth.models import PermissionsMixin, UserManager
from django.contrib.auth.validators import ASCIIUsernameValidator
from django.db import models
from imagekit.models import ImageSpecField
from pilkit.processors import ResizeToFill
from django.core.files import File

def users_avatars_path(instance, filename):
    # the file will be uploaded to
    #   MEDIA_ROOT / user_<username> / avatars / <filename>
    num = int(time() * 1000)
    suf = Path(filename).suffix
    return f"user_{instance.username}/avatars/pic_{num}{suf}"


class CustomUser(AbstractBaseUser, PermissionsMixin):
    GENDER_CHOICES = [
        ('male', 'Мужчина'),
        ('female', 'Женщина'), ]
    STATUS = [
        ('online', 'в сети'),
        ('offline', 'не в сети'),
    ]
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
    gender = models.CharField(max_length=20, choices=GENDER_CHOICES, default='male')
    birthday = models.DateField("День рождения", blank=True, null=True)
    avatar = models.ImageField(
        "Ваше фото", upload_to=users_avatars_path, blank=True, null=True
    )
    thumbnail = ImageSpecField(
        source='avatar',
        processors=[ResizeToFill(100, 100)],
        format='JPEG',
        options={'quality': 90},
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
    is_online = models.CharField(
        max_length=20, choices=STATUS, default='offline'
    )
    date_joined = models.DateTimeField("Дата регистрации", auto_now_add=True)
    last_joined = models.DateTimeField("<UNK> <UNK>", auto_now=True)
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

    def save(self, *args, **kwargs):
        if not self.avatar and self.gender:  # Проверяем, есть ли пол и аватар
            # Use BASE_DIR to get the correct path to static files
            base_dir = Path(settings.BASE_DIR)
            if self.gender == 'male':
                default_avatar_path = base_dir / 'static' / 'img' / 'avatar' / 'male.png'
            else:
                default_avatar_path = base_dir / 'static' / 'img' / 'avatar' / 'female.png'

            try:
                if default_avatar_path.exists():
                    with open(default_avatar_path, 'rb') as f:
                        filename = f'default_avatar_{self.gender}.png'
                        self.avatar.save(filename, File(f), save=False)
                else:
                    print(f"Файл дефолтного аватара не найден: {default_avatar_path}")
            except Exception as e:
                print(f"Ошибка при установке дефолтного аватара: {e}")
        super().save(*args, **kwargs)  # вызов родительского метода save()