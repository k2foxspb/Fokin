import os

from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.backend.settings')
app = Celery('celery')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.conf.broker_url = 'redis://127.0.0.1:6379'
app.autodiscover_tasks()



