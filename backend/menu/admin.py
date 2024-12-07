from django.contrib import admin

from menu.models import Categories, Dish


# Register your models here.
@admin.register(Categories)
class CategoriesAdmin(admin.ModelAdmin):
    prepopulated_fields = {'slug': ('name',)}

@admin.register(Dish)
class DishesAdmin(admin.ModelAdmin):
    prepopulated_fields = {'slug': ('name',)}
    list_display = ['id', 'name', 'price', 'discount']
    list_editable = ['discount']
    search_fields = ['name', 'description']
    list_filter = ['category', 'discount']
    fields = [
        'name',
        'category',
        'slug',
        'description',
        'image',
        ('price', 'discount'),
        'weight',

    ]