from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from celery import shared_task
from django.utils import timezone

from backend.settings import EMAIL_HOST_USER


@shared_task()
def send_feedback_email_task(email, firs_name, last_name):
    """Sends an email when the feedback form has been submitted."""
    send_mail(
        "Your Feedback",
        f"\t{firs_name} {last_name}\n\nСпасибо за регистрацию!",
        EMAIL_HOST_USER,
        [email],
        fail_silently=False,
    )


@shared_task()
def send_feedback_email_task_update(email, firs_name, last_name):
    """Sends an email when the feedback form has been submitted."""
    send_mail(
        "Your Feedback",
        f"\t{firs_name} {last_name}\n\nВы изменили учётную запись!",
        EMAIL_HOST_USER,
        [email],
        fail_silently=False,
    )


@shared_task
def delete_unconfirmed_user(user_id):
   User = get_user_model()
   try:
       user = User.objects.get(pk=user_id)
       if not user.is_active and user.date_joined < timezone.now() - timedelta(minutes=1):
           user.delete()
   except User.DoesNotExist:
       pass # Пользователь уже удален или не найден