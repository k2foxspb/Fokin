from django.db import models

# Create your models here.
from menu.models import Dish

from users.models import CustomUser


class OrderitemQueryset(models.QuerySet):

    def total_price(self):
        return sum(cart.products_price() for cart in self)

    def total_quantity(self):
        if self:
            return sum(cart.quantity for cart in self)
        return 0

# Create your models here.
class Order(models.Model):
    customer = models.ForeignKey(to=CustomUser, on_delete=models.SET_DEFAULT, blank=True, null=True,
                             verbose_name="Покупатель", default=None, related_name = "customer")
    courier = models.ForeignKey(to=CustomUser, on_delete=models.SET_DEFAULT, blank=True, null=True,
                                verbose_name="Курьер", default=None, related_name = "courier")
    created_timestamp = models.DateTimeField(auto_now_add=True, verbose_name="Дата заказа")
    phone_number = models.CharField(max_length=20, verbose_name="Номер телефона")
    delivery_address = models.TextField(null=True, blank=True, verbose_name="Адрес")
    payment_on_get = models.BooleanField(default=False, verbose_name="Оплата при получении")
    is_paid = models.BooleanField(default=False, verbose_name="Оплачено")
    status = models.CharField(max_length=50, default='Процесс', verbose_name="Статус")

    class Meta:
        db_table = "order"
        verbose_name = "Заказ"
        verbose_name_plural = "Заказы"
        ordering = ("id",)

    def __str__(self):
        return f"Заказ № {self.pk} | Покупатель {self.customer.first_name} {self.customer.last_name}"


class OrderItem(models.Model):
    order = models.ForeignKey(to=Order, on_delete=models.CASCADE, verbose_name="Заказ")
    dish = models.ForeignKey(to=Dish, on_delete=models.SET_DEFAULT, null=True, verbose_name="Блюдо", default=None)
    name = models.CharField(max_length=150, verbose_name="Название")
    price = models.DecimalField(max_digits=7, decimal_places=2, verbose_name="Цена")
    quantity = models.PositiveIntegerField(default=0, verbose_name="Количество")
    created_timestamp = models.DateTimeField(auto_now_add=True, verbose_name="Дата продажи")


    class Meta:
        db_table = "order_item"
        verbose_name = "Состав заказа"
        verbose_name_plural = "Составы заказов"
        ordering = ("id",)

    objects = OrderitemQueryset.as_manager()

    def products_price(self):
        return round(self.dish * self.quantity, 2)

    def __str__(self):
        return f"Блюдо {self.name} | Заказ № {self.order.pk}"