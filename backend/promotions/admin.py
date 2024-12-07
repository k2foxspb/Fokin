from django.contrib import admin

from promotions.models import Promotion


# Register your models here.
@admin.register(Promotion)
class PromotionAdmin(admin.ModelAdmin):
    pass