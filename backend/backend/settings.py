import os
from pathlib import Path
import environ


env = environ.Env(DEBUG=(bool, False))
BASE_DIR = Path(__file__).resolve().parent.parent
env.read_env(os.path.join(BASE_DIR, ".env"))
SECRET_KEY = env('SECRET_KEY')
DEBUG = env('DEBUG')
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS")
ROOT_URLCONF = "backend.urls"


CELERY_BROKER_URL = 'redis://127.0.0.1:6379'  # Redis URL
CELERY_RESULT_BACKEND = 'redis://127.0.0.1:6379' # Опционально, для хранения результатов задач
CELERY_ACCEPT_CONTENT = ['application/json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'Europe/Moscow' # Укажите ваш часовой пояс

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "main_app.apps.MainAppConfig",
    "crispy_forms",
    "crispy_bootstrap5",
    "authapp.apps.AuthappConfig",
    'django_ckeditor_5',
    "django.contrib.sites",
    'chatapp',
    'django_comments',
    'photo_alboms',
    'imagekit',
    'profileapp',
    'storages',
    'celery'

]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]



TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [os.path.join(BASE_DIR, "templates")],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "backend.wsgi.application"
ASGI_APPLICATION = 'backend.asgi.application'
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [('127.0.0.1', 6379)],
        },
    },
}


DATABASES = {
    "default": env.db(),
    'TEST': {
        'NAME': os.path.join(BASE_DIR, 'db_test.sqlite3')
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.CommonPasswordValidator",
    },
    {
        "NAME": "django.contrib.auth.password_validation.NumericPasswordValidator",
    },
]

LANGUAGE_CODE = "ru"
TIME_ZONE = "Europe/Moscow"
USE_I18N = True
USE_TZ = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

STATICFILES_DIRS = [
    BASE_DIR / "static/",
]

STATIC_ROOT = os.path.join(BASE_DIR, "staticfiles")
MEDIA_ROOT = os.path.join(BASE_DIR, "media/")
MEDIA_URL = "/media/"

CRISPY_TEMPLATE_PACK = "bootstrap5"
CRISPY_ALLOWED_TEMPLATE_PACKS = "bootstrap5"

AUTH_USER_MODEL = "authapp.CustomUser"
LOGIN_REDIRECT_URL = "main:main_category"
LOGOUT_REDIRECT_URL = "main:main_category"
AUTHENTICATION_BACKENDS = ["authapp.backend.UserModelBackend"]

EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
EMAIL_HOST = "smtp.mail.ru"
EMAIL_HOST_USER = "k2foxspb@mail.ru"
EMAIL_HOST_PASSWORD = env('EMAIL_HOST_PASSWORD')
EMAIL_PORT = 465
EMAIL_USE_SSL = True
DEFAULT_FROM_EMAIL = 'k2foxspb@mail.ru'

CKEDITOR_UPLOAD_PATH = "uploads/"

STATIC_URL = '/static/'
customColorPalette = [
    {
        'color': 'hsl(4, 90%, 58%)',
        'label': 'Red'
    },
    {
        'color': 'hsl(340, 82%, 52%)',
        'label': 'Pink'
    },
    {
        'color': 'hsl(291, 64%, 42%)',
        'label': 'Purple'
    },
    {
        'color': 'hsl(262, 52%, 47%)',
        'label': 'Deep Purple'
    },
    {
        'color': 'hsl(231, 48%, 48%)',
        'label': 'Indigo'
    },
    {
        'color': 'hsl(207, 90%, 54%)',
        'label': 'Blue'
    },
]

CKEDITOR_5_UPLOAD_FILE_TYPES = ['jpeg', 'jpg', 'png']
# CKEDITOR_5_FILE_STORAGE = "blog.storage.CustomStorage"
CKEDITOR_5_ALLOW_ALL_FILE_TYPES = True  # загрузить любые файлы
CKEDITOR_5_CONFIGS = {
    'extends': {
        'toolbar': {
            'items': [
                'undo', 'redo', '|', 'selectAll', 'findAndReplace', '|', 'heading', '|', 'fontSize', 'fontColor',
                'fontBackgroundColor', '|', 'bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript',
                'highlight', '|', 'link', 'insertImage', 'mediaEmbed', 'fileUpload', 'insertTable', '|',
                'blockQuote', 'specialCharacters', 'horizontalLine', '|', 'alignment', 'bulletedList', 'numberedList',
                'outdent', 'indent', 'removeFormat'
            ],
            'shouldNotGroupWhenFull': True
        },
        'language': 'ru',
        'fontSize': {
            'options': [10, 12, 14, 'default', 18, 20, 22],
            'supportAllValues': True
        },
        'heading': {
            'options': [
                {
                    'model': 'paragraph',
                    'title': 'Paragraph',
                    'class': 'ck-heading_paragraph'
                },
                {
                    'model': 'heading1',
                    'view': 'h1',
                    'title': 'Heading 1',
                    'class': 'ck-heading_heading1'
                },
                {
                    'model': 'heading2',
                    'view': 'h2',
                    'title': 'Heading 2',
                    'class': 'ck-heading_heading2'
                },
                {
                    'model': 'heading3',
                    'view': 'h3',
                    'title': 'Heading 3',
                    'class': 'ck-heading_heading3'
                },
                {
                    'model': 'heading4',
                    'view': 'h4',
                    'title': 'Heading 4',
                    'class': 'ck-heading_heading4'
                },
                {
                    'model': 'heading5',
                    'view': 'h5',
                    'title': 'Heading 5',
                    'class': 'ck-heading_heading5'
                },
                {
                    'model': 'heading6',
                    'view': 'h6',
                    'title': 'Heading 6',
                    'class': 'ck-heading_heading6'
                }
            ]
        },
        'htmlSupport': {
            'allow': [
                {
                    'name': '/^.*$/',
                    'styles': True,
                    'attributes': True,
                    'classes': True
                }
            ]
        },
        'image': {
            'toolbar': [
                'toggleImageCaption', 'imageTextAlternative', '|', 'imageStyle:inline', 'imageStyle:wrapText',
                'imageStyle:breakText', '|', 'resizeImage'
            ]
        },
        'link': {
            'addTargetToExternalLinks': True,
            'defaultProtocol': 'https://',
            'decorators': {
                'toggleDownloadable': {
                    'mode': 'manual',
                    'label': 'Downloadable',
                    'attributes': {
                        'download': 'file'
                    }
                }
            }
        },
        'list': {
            'properties': {
                'styles': True,
                'startIndex': True,
                'reversed': True
            }
        },
        'placeholder': 'Type something',
        'table': {
            'contentToolbar': ['tableColumn', 'tableRow', 'mergeTableCells', 'tableProperties', 'tableCellProperties']
        },
    }
}

# Define a constant in settings.py to specify file upload permissions
CKEDITOR_5_FILE_UPLOAD_PERMISSION = "staff"  # Possible values: "staff", "authenticated", "any"
CKEDITOR_5_CUSTOM_CSS = 'css/my.css'
SITE_ID = 1
ADMINS = [('Валерий', 'k2foxspb@mail.ru')]
MANAGERS = ADMINS
MESSAGE_STORAGE = "django.contrib.messages.storage.session.SessionStorage"

# storage
if not DEBUG:
    STORAGES = {
        "default": {"BACKEND": "storages.backends.s3boto3.S3Boto3Storage"},
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        },
    }
    AWS_DEFAULT_REGION = 'ru-central1-a'
    AWS_STORAGE_BUCKET_NAME = 'fokin.fun'
    AWS_S3_ENDPOINT_URL = 'https://storage.yandexcloud.net/'
    AWS_ACCESS_KEY_ID = env('AWS_ACCESS_KEY_ID')
    AWS_SECRET_ACCESS_KEY = env('AWS_SECRET_ACCESS_KEY')
# storage and image = models.FileField(upload_to='my_files/', storage=default_storage)

# 1) iex (New-Object System.Net.WebClient).DownloadString('https://storage.yandexcloud.net/yandexcloud-yc/install.ps1')
# 2)
