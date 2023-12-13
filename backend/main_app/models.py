from pathlib import Path
from time import time

from ckeditor_uploader.fields import RichTextUploadingField

from ckeditor_uploader.widgets import CKEditorUploadingWidget
from django.db import models
from django.urls import reverse

from main_app.services.utils import unique_slugify


def news_image_path(instance, filename):
    # file will be uploaded to
    #   MEDIA_ROOT / user_<username> / avatars / <filename>
    num = int(time() * 1000)
    suf = Path(filename).suffix
    return f"news_{instance.title}/image/pic_{num}{suf}"


STATUS_CHOICES = [("del", "Delete"), ("pu", "Published"), ("wi", "Withdrawn")]


class Article(models.Model):
    widget = CKEditorUploadingWidget()
    title = models.CharField(max_length=256, unique=True, verbose_name="Заголовок")
    preamble = models.CharField(max_length=1024, verbose_name="Преамбула")
    category = models.ForeignKey(
        "Category", on_delete=models.CASCADE, verbose_name="Категория", default=None
    )
    content = RichTextUploadingField(blank=True)
    created = models.DateTimeField(
        auto_now_add=True, verbose_name="Создано", editable=False
    )
    updated = models.DateTimeField(
        auto_now=True,
        verbose_name="Отредактировано",
    )
    slug = models.CharField(
        verbose_name="URL-адрес",
        max_length=255,
        blank=True,
        unique=True,
        editable=False,
    )

    keyword = models.CharField(
        max_length=255, blank=True, verbose_name="ключевые слова"
    )
    status = models.CharField(max_length=3, choices=STATUS_CHOICES, default="pu")

    def get_absolute_url(self):
        return reverse("main:news_detail", kwargs={"slug": self.slug})

    def __str__(self) -> str:
        return f"{self.title}"

    def delete(self, *args):
        self.status = "del"
        self.save()

    def save(self, *args, **kwargs):
        """
        Сохранение полей модели при их отсутствии заполнения
        """
        if not self.slug:
            self.slug = unique_slugify(self, self.title)
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = "Статья"
        verbose_name_plural = "Статьи"
        ordering = ("-updated",)


class Category(models.Model):
    title = models.CharField(max_length=255, unique=True, verbose_name="Заголовок")
    slug = models.CharField(
        verbose_name="URL-адрес",
        max_length=255,
        blank=True,
        unique=True,
        editable=False,
    )

    def get_article(self):
        return self.article_set.all()

    def get_absolute_url(self):
        return reverse("", kwargs={"slug": self.slug})

    def save(self, *args, **kwargs):
        """
        Сохранение полей модели при их отсутствии заполнения
        """
        if not self.slug:
            self.slug = unique_slugify(self, self.title)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title

    class Meta:
        verbose_name = "Категория"
        verbose_name_plural = "Категории"
