from django.contrib import admin

from carts.models import Cart

# Register your models here.
#
class CartTabAdmin(admin.TabularInline):
    model = Cart
    fields = "dish", "quantity", "created_timeslape"
    search_fields = "dish", "quantity", "created_timeslape"
    readonly_fields = ("created_timeslape",)
    extra = 1

@admin.register(Cart)
class CartAdmin(admin.ModelAdmin):
    list_display = ['user','dish', 'quantity', 'created_timeslape']
    list_filter = ['created_timeslape', 'user', 'dish__name']

    def user_display(self, obj):
        if obj.user:
            return str(obj.user)
        return "Anonymys user"

