# Generated by Django 4.2.6 on 2025-05-10 18:45

from django.db import migrations, models
import photo_alboms.models


class Migration(migrations.Migration):
    dependencies = [
        ("photo_alboms", "0006_alter_photoalbum_hidden_flag"),
    ]

    operations = [
        migrations.AlterField(
            model_name="photo",
            name="image",
            field=models.FileField(upload_to=photo_alboms.models.save_photos),
        ),
    ]
