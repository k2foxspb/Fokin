from django.shortcuts import render, get_object_or_404

from menu.models import Dish

from menu.models import Categories


# Create your views here.
def menu(request, restaurant_slug):
    dishes = Dish.objects.all()
    categories = Categories.objects.filter(dish__in=dishes).distinct()
    dishes_by_category = {}

    for category in categories:
        dishes_in_category = dishes.filter(category=category)
        dishes_by_category[category] = dishes_in_category

    context = {
        "dishes": dishes,
        'categories': categories,
        'dishes_by_category': dishes_by_category,

    }

    return render(request, 'menu/restaurant_menu.html', context)

def dish_detail(request, restaurant_slug, dish_id):
    dish = get_object_or_404(Dish, id=dish_id)
    return render(request, 'includes/modal_dish.html', {'dish': dish, 'content_type': 'dish'})

