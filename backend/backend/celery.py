import os

from celery import Celery
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')
app = Celery('celery', broker=' redis://localhost')

@app.task
def add(x, y):
    return x + y
