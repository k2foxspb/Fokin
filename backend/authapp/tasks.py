# from django.core.mail import send_mail
# from celery import shared_task

# from backend.settings import EMAIL_HOST_USER


# @shared_task()
# def send_feedback_email_task(email, firs_name, last_name):
#     """Sends an email when the feedback form has been submitted."""
#     send_mail(
#         "Your Feedback",
#         f"\t{firs_name} {last_name}\n\nСпасибо за регистрацию!",
#         EMAIL_HOST_USER,
#         [email],
#         fail_silently=False,
#     )


# @shared_task()
# def send_feedback_email_task_update(email, firs_name, last_name):
#     """Sends an email when the feedback form has been submitted."""
#     send_mail(
#         "Your Feedback",
#         f"\t{firs_name} {last_name}\n\nВы изменили учётную запись!",
#         EMAIL_HOST_USER,
#         [email],
#         fail_silently=False,
#     )
