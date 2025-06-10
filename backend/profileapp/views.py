from datetime import date

from django.contrib.auth.decorators import login_required
from django.shortcuts import render, get_object_or_404
from django.core.paginator import Paginator, EmptyPage, PageNotAnInteger
from authapp.models import CustomUser

@login_required(login_url='auth:login')
def profile_view(request, username):
    user = get_object_or_404(CustomUser, username=username)
    is_authenticated = request.user.is_authenticated
    user_come = request.user
    today = date.today()
    if user.birthday:
        age = today.year - user.birthday.year
    else:
        age = 'нет'
    context = {
        'user': user,
        'is_authenticated': is_authenticated,
        'user_come': user_come,
        'age': age,
    }
    return render(request, 'profile.html', context)

def all_users_view(request):
    users = CustomUser.objects.all()
    q = request.GET.get('q')
    if q:
        users = users.filter(username__icontains=q)  # Case-insensitive search

    paginator = Paginator(users, 10)  # Show 10 users per page
    page_number = request.GET.get('page')
    try:
        users = paginator.page(page_number)
    except PageNotAnInteger:
        # If page is not an integer, deliver first page.
        users = paginator.page(1)
    except EmptyPage:
        # If page is out of range (e.g., 9999), deliver last page of results.
        users = paginator.page(paginator.num_pages)

    return render(request, 'all_users.html', {'users': users})
