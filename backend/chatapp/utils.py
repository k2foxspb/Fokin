def get_default_avatar(user):
    gender = user.gender.lower()
    if gender == 'male':
        return '/static/img/avatar/male.png'  # Path to your default male avatar
    else:
        return '/static/img/avatar/male.png'  # Path to your default female avatar
