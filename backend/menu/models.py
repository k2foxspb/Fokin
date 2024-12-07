from django.db import models

# Create your models here.
from django.db import models
from django.urls import reverse



class Categories(models.Model):
    name = models.CharField(max_length=150, unique=True, verbose_name='Название')
    slug = models.SlugField(max_length=200, unique=True, blank=True, null=True, verbose_name='URL')

    class Meta:
        db_table = 'category'
        verbose_name = 'Категорию'
        verbose_name_plural = 'Категории'

    def __str__(self): # перегружаем для отображения названия в бд
        return self.name

class Dish(models.Model):
    name = models.CharField(max_length=150, unique=True, verbose_name='Название')
    slug = models.SlugField(max_length=200, unique=True, blank=True, null=True, verbose_name='URL')
    description = models.TextField(blank=True, null=True, verbose_name='Описание')
    image = models.ImageField(upload_to='dishes_images', blank=True, null=True, verbose_name='Изображение')
    price = models.DecimalField(default=0.00, max_digits=7, decimal_places=2, verbose_name='Цена')
    discount = models.DecimalField(default=0.00, max_digits=7, decimal_places=2, verbose_name='Скидка в %')
    weight = models.IntegerField(blank=True, null=True, verbose_name='Вес')
    category = models.ForeignKey(to=Categories, on_delete=models.CASCADE, verbose_name='Категория')


    # on_delete бывает:
    # - PROTECT (самый безопастный, не дает удалять,
    # - CASCADE (удаляются и все товары, закрепленные за категорией (с предупреждением))
    # - SET_DEFAULT (всем товарам присвоено default value)
    class Meta:
        db_table = 'dish'
        verbose_name = 'Блюдо'
        verbose_name_plural = 'Блюда'
        ordering: ("id",)

    def __str__(self):
        return f'{self.name}'

    def display_id(self):
        return f'{self.id:05}'

    def sell_price(self):
        if self.discount:
            return round(self.price - self.price * self.discount / 100, 2)
        else:
            return self.price

    # def get_absolute_url(self):
    #     return reverse("catalog:product", kwargs={"product_slug":self.slug})