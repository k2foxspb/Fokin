# Generated by Django 4.2.6 on 2025-05-12 08:14

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("chatapp", "0008_rename_is_read_privatemessage_read_delete_indexview"),
    ]

    operations = [
        migrations.AddField(
            model_name="privatechatroom",
            name="name",
            field=models.CharField(blank=True, max_length=255, unique=True),
        ),
    ]
