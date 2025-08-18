from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def save_push_token(request):
    """Сохраняет Expo Push Token пользователя"""
    try:
        push_token = request.data.get('pushToken')
        if not push_token:
            return Response({'error': 'Push token is required'}, status=status.HTTP_400_BAD_REQUEST)

        # Сохраняем токен для текущего пользователя
        request.user.expo_push_token = push_token
        request.user.save()

        return Response({'message': 'Push token saved successfully'}, status=status.HTTP_200_OK)

    except Exception as e:
        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.authtoken.models import Token
from django.contrib.auth import authenticate, get_user_model
from django.core.mail import send_mail
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.conf import settings
from django.template.loader import render_to_string
import random
import string
from django.utils import timezone
from datetime import timedelta

from authapp.serializer import UserSerializer

# Получаем кастомную модель пользователя
User = get_user_model()

# Функция для генерации случайного кода подтверждения
def generate_verification_code(length=6):
    return ''.join(random.choices(string.digits, k=length))

@api_view(['POST'])
@permission_classes([IsAuthenticated])
def update_push_token(request):
    push_token = request.data.get('push_token')
    if push_token:

        request.user.expo_push_token = push_token
        request.user.save()
        return Response({'status': 'success'})
    return Response({'error': 'No token provided'}, status=400)

class LoginAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        print("LOGIN API - Received data:", request.data)  # Отладка

        username = request.data.get('username')
        password = request.data.get('password')

        user = authenticate(username=username, password=password)

        if user:
            token, created = Token.objects.get_or_create(user=user)
            serializer = UserSerializer(user)
            return Response({
                'token': token.key,
                'user': serializer.data
            })
        return Response(
            {'error': 'Неверные учетные данные'},
            status=status.HTTP_400_BAD_REQUEST
        )


class RegisterAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        # Отладочная информация
        print("REGISTER API - Received data:", request.data)
        print("REGISTER API - Content-Type:", request.content_type)
        print("REGISTER API - Request method:", request.method)

        username = request.data.get('username')
        email = request.data.get('email')
        password = request.data.get('password')
        password_confirm = request.data.get('password_confirm')
        first_name = request.data.get('first_name', '')
        last_name = request.data.get('last_name', '')
        gender = request.data.get('gender', 'male')
        birthday = request.data.get('birthday')
        avatar = request.FILES.get('avatar')

        print(f"REGISTER API - Parsed fields:")
        print(f"  username: {username}")
        print(f"  email: {email}")
        print(f"  password: {'***' if password else None}")
        print(f"  password_confirm: {'***' if password_confirm else None}")
        print(f"  first_name: {first_name}")
        print(f"  last_name: {last_name}")
        print(f"  gender: {gender}")
        print(f"  birthday: {birthday}")
        print(f"  avatar: {avatar}")

        # Валидация данных
        if not username or not email or not password or not password_confirm:
            print("REGISTER API - Missing required fields")
            return Response(
                {'error': 'Все поля обязательны для заполнения'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if password != password_confirm:
            print("REGISTER API - Passwords don't match")
            return Response(
                {'error': 'Пароли не совпадают'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if len(password) < 6:
            print("REGISTER API - Password too short")
            return Response(
                {'error': 'Пароль должен содержать минимум 6 символов'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if gender not in ['male', 'female']:
            print("REGISTER API - Invalid gender")
            return Response(
                {'error': 'Пол может быть только "male" или "female"'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Проверка существования пользователя
        if User.objects.filter(username=username).exists():
            print("REGISTER API - Username already exists")
            return Response(
                {'error': 'Пользователь с таким именем уже существует'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if User.objects.filter(email=email).exists():
            print("REGISTER API - Email already exists")
            return Response(
                {'error': 'Пользователь с таким email уже существует'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            print("REGISTER API - Creating user...")
            # Создание пользователя с хешированием пароля
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password
            )

            # Добавление дополнительных полей
            user.first_name = first_name
            user.last_name = last_name
            user.gender = gender
            user.is_active = False  # Пользователь неактивен до подтверждения email
            if birthday:
                user.birthday = birthday
            if avatar:
                user.avatar = avatar
            
            # Генерация кода подтверждения
            verification_code = generate_verification_code()
            user.verification_code = verification_code
            user.verification_code_expires = timezone.now() + timedelta(hours=24)  # Код действителен 24 часа
            user.save()

            print(f"REGISTER API - User created successfully: {user.username}")

            # Отправка email с кодом подтверждения
            subject = 'Подтверждение регистрации'
            message = f'''
            Здравствуйте, {user.username}!

            Спасибо за регистрацию. Для подтверждения вашего email, пожалуйста, введите следующий код:

            {verification_code}

            Код действителен в течение 24 часов.

            С уважением,
            Команда поддержки
            '''

            try:
                send_mail(
                    subject,
                    message,
                    settings.DEFAULT_FROM_EMAIL,
                    [email],
                    fail_silently=False,
                )
                print(f"REGISTER API - Verification email sent to {email}")
            except Exception as e:
                print(f"REGISTER API - Error sending email: {str(e)}")
                # Продолжаем выполнение даже если email не отправлен

            # Создание токена
            token, created = Token.objects.get_or_create(user=user)
            serializer = UserSerializer(user)

            print("REGISTER API - Sending success response")
            return Response({
                'token': token.key,
                'user': serializer.data,
                'message': 'Пользователь создан. Пожалуйста, подтвердите ваш email.',
                'requires_verification': True
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            print(f"REGISTER API - Error creating user: {str(e)}")
            import traceback
            traceback.print_exc()
            return Response(
                {'error': f'Ошибка при создании пользователя: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PasswordResetAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        email = request.data.get('email')

        if not email:
            return Response(
                {'error': 'Email обязателен для заполнения'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            # Возвращаем успешный ответ даже если пользователь не найден
            # для безопасности (не раскрываем существование email)
            return Response(
                {'message': 'Если пользователь с таким email существует, инструкции отправлены на почту'},
                status=status.HTTP_200_OK
            )

        # Генерация токена для сброса пароля
        token = default_token_generator.make_token(user)
        uid = urlsafe_base64_encode(force_bytes(user.pk))

        # Формирование данных для сброса пароля
        # Вместо веб-ссылки отправляем код для мобильного приложения
        reset_code = generate_verification_code(8)  # Генерируем 8-значный код

        # Сохраняем код и токен для пользователя
        user.verification_code = reset_code
        user.verification_code_expires = timezone.now() + timedelta(hours=2)  # Код действителен 2 часа
        user.password_reset_token = token  # Дополнительно сохраняем токен Django
        user.password_reset_uid = uid
        user.save()

        # Отправка email с кодом вместо ссылки
        subject = 'Восстановление пароля'
        message = f'''
        Здравствуйте, {user.username}!

        Вы запросили восстановление пароля для вашего аккаунта.

        Ваш код для восстановления пароля:
        {reset_code}

        Введите этот код в мобильном приложении для сброса пароля.
        Код действителен в течение 2 часов.

        Если вы не запрашивали восстановление пароля, проигнорируйте это письмо.

        С уважением,
        Команда поддержки
        '''

        try:
            send_mail(
                subject,
                message,
                settings.DEFAULT_FROM_EMAIL,
                [email],
                fail_silently=False,
            )
        except Exception as e:
            return Response(
                {'error': 'Ошибка при отправке email'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        return Response(
            {'message': 'Инструкции по восстановлению пароля отправлены на ваш email'},
            status=status.HTTP_200_OK
        )


class VerifyEmailAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        print("VERIFY EMAIL API - Received data:", request.data)

        email = request.data.get('email')
        verification_code = request.data.get('verification_code')

        print(f"VERIFY EMAIL API - Email: {email}, Code: {verification_code}")

        if not email or not verification_code:
            return Response(
                {'error': 'Email и код подтверждения обязательны'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
            print(f"VERIFY EMAIL API - Found user: {user.username}, is_active: {user.is_active}")
        except User.DoesNotExist:
            print(f"VERIFY EMAIL API - User with email {email} not found")
            return Response(
                {'error': 'Пользователь с таким email не найден'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Проверяем код подтверждения
        print(f"VERIFY EMAIL API - User verification_code: {user.verification_code}")
        if not user.verification_code or user.verification_code != verification_code:
            print("VERIFY EMAIL API - Invalid verification code")
            return Response(
                {'error': 'Неверный код подтверждения'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Проверяем срок действия кода
        if not user.verification_code_expires or timezone.now() > user.verification_code_expires:
            print("VERIFY EMAIL API - Verification code expired")
            return Response(
                {'error': 'Срок действия кода истек. Запросите новый код.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Активируем пользователя
        print("VERIFY EMAIL API - Activating user...")
        user.is_active = True
        user.verification_code = None
        user.verification_code_expires = None
        user.save()

        print(f"VERIFY EMAIL API - User activated: is_active = {user.is_active}")

        # Создаем или получаем токен
        token, created = Token.objects.get_or_create(user=user)
        serializer = UserSerializer(user)

        response_data = {
            'token': token.key,
            'user': serializer.data,
            'message': 'Email успешно подтвержден и пользователь активирован'
        }

        print("VERIFY EMAIL API - Sending response:", response_data)

        return Response(response_data, status=status.HTTP_200_OK)


class ResendVerificationAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        email = request.data.get('email')

        if not email:
            return Response(
                {'error': 'Email обязателен'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {'error': 'Пользователь с таким email не найден'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Генерируем новый код подтверждения
        verification_code = generate_verification_code()
        user.verification_code = verification_code
        user.verification_code_expires = timezone.now() + timedelta(hours=24)
        user.save()

        # Отправляем email с кодом подтверждения
        subject = 'Подтверждение регистрации'
        message = f'''
        Здравствуйте, {user.username}!

        Вы запросили новый код подтверждения. Для подтверждения вашего email, пожалуйста, введите следующий код:

        {verification_code}

        Код действителен в течение 24 часов.

        С уважением,
        Команда поддержки
        '''

        try:
            send_mail(
                subject,
                message,
                settings.DEFAULT_FROM_EMAIL,
                [email],
                fail_silently=False,
            )
        except Exception as e:
            return Response(
                {'error': f'Ошибка при отправке email: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        return Response({
            'message': 'Новый код подтверждения отправлен на ваш email'
        }, status=status.HTTP_200_OK)


class ActivateUserAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        print("ACTIVATE USER API - Received data:", request.data)

        email = request.data.get('email')

        if not email:
            return Response(
                {'error': 'Email обязателен'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
            print(f"ACTIVATE USER API - Found user: {user.username}, current is_active: {user.is_active}")

            # Принудительно активируем пользователя
            user.is_active = True
            user.save()

            print(f"ACTIVATE USER API - User activated: is_active = {user.is_active}")

            # Обновляем пользователя из базы данных для подтверждения
            user.refresh_from_db()
            print(f"ACTIVATE USER API - Confirmed from DB: is_active = {user.is_active}")

            serializer = UserSerializer(user)

            return Response({
                'user': serializer.data,
                'message': 'Пользователь успешно активирован',
                'is_active': user.is_active
            }, status=status.HTTP_200_OK)

        except User.DoesNotExist:
            print(f"ACTIVATE USER API - User with email {email} not found")
            return Response(
                {'error': 'Пользователь с таким email не найден'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            print(f"ACTIVATE USER API - Error: {str(e)}")
            return Response(
                {'error': f'Ошибка при активации: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class UpdateUserStatusAPIView(APIView):
    permission_classes = (AllowAny,)

    def patch(self, request):
        print("UPDATE USER STATUS API - Received data:", request.data)

        email = request.data.get('email')
        is_active = request.data.get('is_active', True)

        if not email:
            return Response(
                {'error': 'Email обязателен'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
            print(f"UPDATE USER STATUS API - Found user: {user.username}")
            print(f"UPDATE USER STATUS API - Current is_active: {user.is_active}")
            print(f"UPDATE USER STATUS API - Setting is_active to: {is_active}")

            # Обновляем статус пользователя
            User.objects.filter(email=email).update(is_active=is_active)

            # Получаем обновленного пользователя
            user.refresh_from_db()
            print(f"UPDATE USER STATUS API - Updated is_active: {user.is_active}")

            serializer = UserSerializer(user)

            return Response({
                'user': serializer.data,
                'message': 'Статус пользователя обновлен',
                'is_active': user.is_active
            }, status=status.HTTP_200_OK)

        except User.DoesNotExist:
            print(f"UPDATE USER STATUS API - User with email {email} not found")
            return Response(
                {'error': 'Пользователь с таким email не найден'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            print(f"UPDATE USER STATUS API - Error: {str(e)}")
            return Response(
                {'error': f'Ошибка при обновлении статуса: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ResetPasswordWithCodeAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        print("RESET PASSWORD WITH CODE API - Received data:", request.data)

        email = request.data.get('email')
        reset_code = request.data.get('reset_code')
        new_password = request.data.get('new_password')
        confirm_password = request.data.get('confirm_password')

        if not all([email, reset_code, new_password, confirm_password]):
            return Response(
                {'error': 'Все поля обязательны для заполнения'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if new_password != confirm_password:
            return Response(
                {'error': 'Пароли не совпадают'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if len(new_password) < 6:
            return Response(
                {'error': 'Пароль должен содержать минимум 6 символов'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
            print(f"RESET PASSWORD WITH CODE API - Found user: {user.username}")
            print(f"RESET PASSWORD WITH CODE API - Stored code: '{user.verification_code}'")
            print(f"RESET PASSWORD WITH CODE API - Received code: '{reset_code}'")

        except User.DoesNotExist:
            print("RESET PASSWORD WITH CODE API - User not found")
            return Response(
                {'error': 'Пользователь с таким email не найден'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Проверяем код сброса
        if not user.verification_code:
            print("RESET PASSWORD WITH CODE API - No verification code stored")
            return Response(
                {'error': 'Код восстановления не найден. Запросите новый код.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if user.verification_code != reset_code:
            print(f"RESET PASSWORD WITH CODE API - Code mismatch. Expected: '{user.verification_code}', Got: '{reset_code}'")
            return Response(
                {'error': 'Неверный код для сброса пароля'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Проверяем срок действия кода
        if not user.verification_code_expires or timezone.now() > user.verification_code_expires:
            print("RESET PASSWORD WITH CODE API - Reset code expired")
            return Response(
                {'error': 'Срок действия кода истек. Запросите новый код.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Устанавливаем новый пароль
        try:
            user.set_password(new_password)
            user.verification_code = None
            user.verification_code_expires = None
            user.password_reset_token = None
            user.password_reset_uid = None
            user.save()

            print(f"RESET PASSWORD WITH CODE API - Password reset successful for user: {user.username}")

            return Response({
                'message': 'Пароль успешно изменен'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"RESET PASSWORD WITH CODE API - Error setting password: {str(e)}")
            return Response(
                {'error': f'Ошибка при изменении пароля: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ResetPasswordConfirmAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        print("RESET PASSWORD CONFIRM API - Received data:", request.data)

        uid = request.data.get('uid')
        token = request.data.get('token')
        new_password = request.data.get('new_password')
        confirm_password = request.data.get('confirm_password')

        if not all([uid, token, new_password, confirm_password]):
            return Response(
                {'error': 'Все поля обязательны для заполнения'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if new_password != confirm_password:
            return Response(
                {'error': 'Пароли не совпадают'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if len(new_password) < 6:
            return Response(
                {'error': 'Пароль должен содержать минимум 6 символов'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Декодируем uid
            user_id = force_str(urlsafe_base64_decode(uid))
            user = User.objects.get(pk=user_id)
            print(f"RESET PASSWORD CONFIRM API - Found user: {user.username}")

        except (ValueError, User.DoesNotExist, TypeError, OverflowError):
            print("RESET PASSWORD CONFIRM API - Invalid uid or user not found")
            return Response(
                {'error': 'Неверная ссылка для сброса пароля'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Проверяем токен
        if not default_token_generator.check_token(user, token):
            print("RESET PASSWORD CONFIRM API - Invalid token")
            return Response(
                {'error': 'Неверный или истекший токен для сброса пароля'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Устанавливаем новый пароль
        try:
            user.set_password(new_password)
            user.save()
            print(f"RESET PASSWORD CONFIRM API - Password reset successful for user: {user.username}")

            return Response({
                'message': 'Пароль успешно изменен'
            }, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"RESET PASSWORD CONFIRM API - Error setting password: {str(e)}")
            return Response(
                {'error': f'Ошибка при изменении пароля: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class LogoutAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        try:
            # Удаляем токен пользователя
            token = Token.objects.get(user=request.user)
            token.delete()
            return Response(
                {'message': 'Успешный выход из системы'},
                status=status.HTTP_200_OK
            )
        except Token.DoesNotExist:
            return Response(
                {'error': 'Токен не найден'},
                status=status.HTTP_400_BAD_REQUEST
            )