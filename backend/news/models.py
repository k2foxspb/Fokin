from django.db import models


class News(models.Model):
    title = models.CharField(max_length=255, verbose_name='Заголовок')
    content = models.TextField(blank=True, editable=False)
    pub_date = models.DateTimeField(auto_now_add=True)




