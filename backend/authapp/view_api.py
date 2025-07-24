from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core.mail import send_mail
from django.contrib.auth.tokens import default_token_generator
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.conf import settings
from django.template.loader import render_to_string

from authapp.serializer import UserSerializer


class LoginAPIView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
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
        username = request.data.get('username')
        email = request.data.get('email')
        password = request.data.get('password')
        password_confirm = request.data.get('password_confirm')

        # Валидация данных
        if not username or not email or not password or not password_confirm:
            return Response(
                {'error': 'Все поля обязательны для заполнения'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if password != password_confirm:
            return Response(
                {'error': 'Пароли не совпадают'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if len(password) < 6:
            return Response(
                {'error': 'Пароль должен содержать минимум 6 символов'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Проверка существования пользователя
        if User.objects.filter(username=username).exists():
            return Response(
                {'error': 'Пользователь с таким именем уже существует'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if User.objects.filter(email=email).exists():
            return Response(
                {'error': 'Пользователь с таким email уже существует'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            # Создание пользователя
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password
            )

            # Создание токена
            token, created = Token.objects.get_or_create(user=user)
            serializer = UserSerializer(user)

            return Response({
                'token': token.key,
                'user': serializer.data
            }, status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response(
                {'error': 'Ошибка при создании пользователя'},
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