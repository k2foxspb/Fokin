from django.contrib.auth.decorators import login_required
from django.shortcuts import render, get_object_or_404
from django.core.paginator import Paginator, EmptyPage, PageNotAnInteger
from authapp.models import CustomUser

@login_required(login_url='auth:login')
def profile_view(request, username):
    user = get_object_or_404(CustomUser, username=username)
    is_authenticated = request.user.is_authenticated
    user_come = request.user
    context = {
        'user': user,
        'is_authenticated': is_authenticated,
        'user_come': user_come,
    }
    return render(request, 'profile.html', context)

def all_users_view(request):
    users = CustomUser.objects.all()
    paginator = Paginator(users, 10) # 10 пользователей на странице

    page_number = request.GET.get('page')
    try:
        users_page = paginator.page(page_number)
    except PageNotAnInteger:
        users_page = paginator.page(1)
    except EmptyPage:
        users_page = paginator.page(paginator.num_pages)

    context = {
        'users': users_page,
        'paginator': paginator,
    }
    print(CustomUser.objects.all())
    return render(request, 'all_users.html', context)

