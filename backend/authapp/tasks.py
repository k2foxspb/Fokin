from time import sleep
from django.core.mail import send_mail
from celery import shared_task
from authapp.models import CustomUser
from backend.celery import app
from backend.settings import EMAIL_HOST_USER


@app.task
def send_feedback_email_task(email, firs_name, last_name):
    """Sends an email when the feedback form has been submitted."""
    send_mail(
        "Your Feedback",
        f"\t{firs_name} {last_name}\n\nСпасибо за регистрацию!",
        EMAIL_HOST_USER,
        [email],
        fail_silently=False,
    )


@app.task
def send_feedback_email_task_update(email, firs_name, last_name):
    """Sends an email when the feedback form has been submitted."""
    send_mail(
        "Your Feedback",
        f"\t{firs_name} {last_name}\n\nВы изменили учётную запись!",
        EMAIL_HOST_USER,
        [email],
        fail_silently=False,
    )


@app.task
def delete_unconfirmed_user(user_id):
   sleep(900)
   user = CustomUser.objects.get(pk=user_id)

   try:
       if not user.is_active:
           user.delete()
       else:
           pass
   except user.DoesNotExist:
       pass # Пользователь уже удален или не найден