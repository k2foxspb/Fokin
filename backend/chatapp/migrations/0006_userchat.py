# Generated by Django 4.2.6 on 2025-04-08 14:04

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("chatapp", "0005_privatechatroom_privatemessage"),
    ]

    operations = [
        migrations.CreateModel(
            name="UserChat",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("unread_count", models.IntegerField(default=0)),
                (
                    "chat_room",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        to="chatapp.privatechatroom",
                    ),
                ),
                (
                    "last_message",
                    models.OneToOneField(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="chatapp.privatemessage",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="chats",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "unique_together": {("user", "chat_room")},
            },
        ),
    ]
