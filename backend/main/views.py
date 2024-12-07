from django.http import JsonResponse
from django.shortcuts import render, get_object_or_404
from menu.models import Categories
from promotions.models import Promotion
# from main.utils import q_search


# Create your views here.
def index(request, category_slug='all'):
	categories = Categories.objects.all()
	sliced_categories = list(categories[:10])

	query = request.GET.get('q', None)
	print(query)


	promotions = Promotion.objects.all()

	context = {
		'title': "Главная страница | YUM",
		'categories': categories,
		'sliced_categories': sliced_categories,
		'promotions': promotions,
	}
	return render(request, 'main/index.html', context)


def about(request):
	context = {
		'title' : "О нас | YUM"
	}
	return render(request, 'main/about.html', context)

def promotion_detail(request, promo_id):
	promotion = get_object_or_404(Promotion, id=promo_id)
	print(f"Promotion ID: {promotion.id}, Name: {promotion.name}")  # Отладочная информация
	return render(request, 'includes/modal_promotion.html', {'promotion': promotion, 'content_type': 'promotion'})

def cart_detail(request):
	return render(request, 'includes/included_cart.html', {'content_type': 'cart'})