from rest_framework import status
from rest_framework.decorators import api_view, permission_classes


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

        # Формирование ссылки для сброса пароля
        reset_url = f"{settings.FRONTEND_URL}/reset-password/{uid}/{token}/"

        # Отправка email
        subject = 'Восстановление пароля'
        message = f'''
        Здравствуйте, {user.username}!

        Вы запросили восстановление пароля для вашего аккаунта.

        Для восстановления пароля перейдите по ссылке:
        {reset_url}

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
        email = request.data.get('email')
        verification_code = request.data.get('verification_code')

        if not email or not verification_code:
            return Response(
                {'error': 'Email и код подтверждения обязательны'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {'error': 'Пользователь с таким email не найден'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Проверяем код подтверждения
        if not user.verification_code or user.verification_code != verification_code:
            return Response(
                {'error': 'Неверный код подтверждения'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Проверяем срок действия кода
        if not user.verification_code_expires or timezone.now() > user.verification_code_expires:
            return Response(
                {'error': 'Срок действия кода истек. Запросите новый код.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Активируем пользователя
        user.is_active = True
        user.verification_code = None
        user.verification_code_expires = None
        user.save()

        # Создаем или получаем токен
        token, created = Token.objects.get_or_create(user=user)
        serializer = UserSerializer(user)

        return Response({
            'token': token.key,
            'user': serializer.data,
            'message': 'Email успешно подтвержден'
        }, status=status.HTTP_200_OK)


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