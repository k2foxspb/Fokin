from django.shortcuts import render, redirect
from django.forms import ValidationError
from django.db import transaction
from django.contrib import messages
from django.contrib.auth.decorators import login_required

from orders.forms import CreateOrderForm
from carts.models import Cart
from orders.models import Order
from orders.models import OrderItem


# Create your views here.
@login_required
def create_order(request):

    if request.method == 'POST':
        form = CreateOrderForm(data=request.POST)
        if form.is_valid():
            try:
                with transaction.atomic(): # атомарные транзакции
                    user = request.user
                    cart_items = Cart.objects.filter(user=user)

                    if cart_items.exists():
                        # создать заказ
                        order = Order.objects.create(
                            customer=user,
                            courier=None,
                            phone_number = form.cleaned_data['phone_number'],
                            delivery_address = form.cleaned_data['delivery_address'],
                            payment_on_get = form.cleaned_data['payment_on_get']
                        )
                        # создать заказанные товары (orderItem)
                        for cart_item in cart_items:
                            dish = cart_item.dish
                            name = cart_item.dish.name
                            price = cart_item.dish.sell_price()
                            quantity = cart_item.quantity

                            OrderItem.objects.create(
                                order=order,
                                dish=dish,
                                name=name,
                                price=price,
                                quantity=quantity,
                            )

                        # очистить корзину после заказа
                        cart_items.delete()

                        return redirect('main:index')

            except ValidationError as e:
                messages.error(request, str(e))
                return redirect('orders:create_order')

    else:
        initial = {
            'first_name' : request.user.first_name,
            'last_name' : request.user.last_name,
            }

        form = CreateOrderForm(initial=initial) # изначальные данные

    context = {
        'title' : 'Оформление заказа',
        'form' : form,
        'order' : True,
    }

    return render(request, 'orders/create_order.html', context=context)