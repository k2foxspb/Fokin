from django.core.management.base import BaseCommand
from authapp.models import CustomUser


class Command(BaseCommand):
    help = 'Удаляет все Expo токены из базы данных и оставляет только Firebase FCM токены'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Показать количество токенов без их удаления',
        )

    def handle(self, *args, **options):
        # Находим пользователей с Expo токенами
        users_with_expo = CustomUser.objects.filter(
            fcm_token__startswith='ExponentPushToken['
        )

        expo_count = users_with_expo.count()

        # Находим пользователей с FCM токенами
        users_with_fcm = CustomUser.objects.filter(
            fcm_token__isnull=False
        ).exclude(
            fcm_token__startswith='ExponentPushToken['
        )

        fcm_count = users_with_fcm.count()

        self.stdout.write(
            self.style.WARNING(f'📊 Найдено токенов в базе данных:')
        )
        self.stdout.write(f'  🔥 Firebase FCM токены: {fcm_count}')
        self.stdout.write(f'  📱 Expo токены (устаревшие): {expo_count}')

        if options['dry_run']:
            if expo_count > 0:
                self.stdout.write(
                    self.style.WARNING(
                        f'\n🚨 [DRY RUN] Будет удалено {expo_count} Expo токенов'
                    )
                )

                # Показываем примеры токенов
                sample_users = users_with_expo[:5]
                for user in sample_users:
                    token_preview = user.fcm_token[:30] + '...' if len(user.fcm_token) > 30 else user.fcm_token
                    self.stdout.write(f'  👤 {user.username}: {token_preview}')

                if expo_count > 5:
                    self.stdout.write(f'  ... и ещё {expo_count - 5} токенов')

            else:
                self.stdout.write(
                    self.style.SUCCESS('✅ Expo токены не найдены - очистка не требуется')
                )

            self.stdout.write(
                self.style.WARNING('\n💡 Для реального удаления запустите без --dry-run')
            )
            return

        if expo_count == 0:
            self.stdout.write(
                self.style.SUCCESS('✅ Expo токены не найдены - очистка не требуется')
            )
            return

        # Реальное удаление
        self.stdout.write(
            self.style.WARNING(f'\n🚨 Начинаем удаление {expo_count} Expo токенов...')
        )

        updated_count = users_with_expo.update(fcm_token=None)

        self.stdout.write(
            self.style.SUCCESS(f'✅ Успешно очищено {updated_count} Expo токенов')
        )

        self.stdout.write(
            self.style.SUCCESS(
                '\n🔥 Теперь система использует только Firebase FCM токены'
            )
        )

        self.stdout.write(
            self.style.WARNING(
                '💡 Пользователи должны перезапустить мобильное приложение '
                'для получения новых FCM токенов'
            )
        )
