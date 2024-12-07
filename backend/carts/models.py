from django.db import models
from decimal import Decimal, ROUND_HALF_UP

from menu.models import Dish
from users.models import CustomUserr


# Create your models here.

class CartQueryset(models.QuerySet):

    # def total_price(self):
    #     return sum(cart.dish_price() for cart in self)

    def total_quantity(self):
        if self:
            return sum(cart.quantity for cart in self)
        return 0

    def courier_price(self):
        # Округляем результат до двух знаков после запятой
        price = sum(cart.dish_price() for cart in self) * Decimal('0.05')
        print(price.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
        return price.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    def total_price(self):
        return sum(cart.dish_price() for cart in self) + self.courier_price()

class Cart(models.Model):
    user = models.ForeignKey(to=CustomUserr, on_delete=models.CASCADE, blank=True, null=True, verbose_name='User')
    dish = models.ForeignKey(to=Dish, on_delete=models.CASCADE, verbose_name='Product')
    quantity = models.PositiveSmallIntegerField(default=0, verbose_name='Quantity')
    session_key = models.CharField(max_length=32, blank=True, null=True)
    created_timeslape = models.DateTimeField(auto_now_add=True, verbose_name='Date')

    class Meta:
        db_table = 'cart'
        verbose_name = 'Корзина'
        verbose_name_plural = 'Корзины'

    objects = CartQueryset().as_manager()
    def __str__(self): # перегружаем для отображения названия в бд
        if self.user:
            return f'Корзина {self.user.username} | Блюдо {self.dish.name} | Количество {self.quantity}'
        return f'Корзина | Продукт {self.dish.name} | Количество {self.quantity}'

    def dish_price(self):
        return self.dish.price * self.quantity