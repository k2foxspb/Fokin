import os

from celery import Celery
from django.conf import settings
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
app = Celery('backend', broker=settings.BROKER_URL)
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
app.conf.broker_url = 'redis://127.0.0.1:6379'