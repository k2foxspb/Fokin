from django.contrib import admin

from menu.models import Categories, Dish


# Register your models here.
@admin.register(Categories)
class CategoriesAdmin(admin.ModelAdmin):
    prepopulated_fields = {'slug': ('name',)}

@admin.register(Dish)
class DishesAdmin(admin.ModelAdmin):
    prepopulated_fields = {'slug': ('name',)}
    list_display = ['id', 'name', 'price', 'discount', 'restaurant']
    list_editable = ['discount']
    search_fields = ['name', 'description', 'restaurant']
    list_filter = ['category', 'discount', 'restaurant']
    fields = [
        'name',
        'category',
        'restaurant',
        'slug',
        'description',
        'image',
        ('price', 'discount'),
        'weight',

    ]