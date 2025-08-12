# Generated migration for adding expo_push_token field

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('authapp', '0002_customuser_avatar_customuser_bio_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='expo_push_token',
            field=models.CharField(blank=True, help_text='Expo Push Token для мобильных уведомлений', max_length=255, null=True),
        ),
    ]
