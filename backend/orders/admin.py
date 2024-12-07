from django.contrib import admin

from orders.models import Order, OrderItem

# Register your models here.


class OrderItemTabulareAdmin(admin.TabularInline):
    model = OrderItem
    fields = 'dish', 'name', 'price', 'quantity'
    search_fields = (
        "dish",
        'name',
    )
    extra=0



class OrderTabulareAdmin(admin.TabularInline):
    model = Order
    fields = ('status', 'payment_on_get', 'is_paid', 'created_timestamp')
    search_fields = ('payment_on_get', 'is_paid', 'created_timestamp')

    readonly_fields = ("created_timestamp", )
    extra=0

@admin.register(OrderItem)
class OrderItemAdmin(admin.ModelAdmin):
    list_display = ['order', 'dish', 'name', 'quantity', 'price']
    search_fields = ['order', 'name', 'dish']


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ['id', 'customer','status', 'payment_on_get', 'is_paid', 'created_timestamp']
    search_fields = ['id']
    readonly_fields = ["created_timestamp"]
    list_filter = ['status', 'payment_on_get', 'is_paid']
    inlines = (OrderItemTabulareAdmin, )


