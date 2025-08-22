from rest_framework import generics, permissions, status
from rest_framework.decorators import api_view, permission_classes as drf_permission_classes
from rest_framework.response import Response
from django.shortcuts import get_object_or_404
from django.db import IntegrityError

from .models import Article, Category, Comment, Like
from .serializers import (
    ArticleSerializer, ArticleListSerializer, CategorySerializer,
    CommentSerializer, CommentCreateSerializer, LikeSerializer
)


class ArticleListAPIView(generics.ListAPIView):
    """
    API view to retrieve list of published articles
    """
    serializer_class = ArticleListSerializer
    permission_classes = [permissions.AllowAny]  # Allow public access for mobile app

    def get_queryset(self):
        # Only return published articles
        return Article.objects.filter(status='pu').select_related('category').prefetch_related('likes', 'comments')


class ArticleDetailAPIView(generics.RetrieveAPIView):
    """
    API view to retrieve a single article by slug
    """
    serializer_class = ArticleSerializer
    permission_classes = [permissions.AllowAny]  # Allow public access for mobile app
    lookup_field = 'slug'

    def get_queryset(self):
        # Only return published articles
        return Article.objects.filter(status='pu').select_related('category').prefetch_related(
            'likes', 'comments__author'
        )


class CategoryListAPIView(generics.ListAPIView):
    """
    API view to retrieve list of published categories
    """
    serializer_class = CategorySerializer
    permission_classes = [permissions.AllowAny]  # Allow public access for mobile app

    def get_queryset(self):
        # Only return published categories
        return Category.objects.filter(status='pu')


class ArticleCommentsAPIView(generics.ListCreateAPIView):
    """
    API view to retrieve and create comments for an article
    """
    serializer_class = CommentSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        article_slug = self.kwargs['slug']
        article = get_object_or_404(Article, slug=article_slug, status='pu')
        return article.comments.filter(is_approved=True).select_related('author')

    def get_serializer_class(self):
        if self.request.method == 'POST':
            return CommentCreateSerializer
        return CommentSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        article_slug = self.kwargs['slug']
        article = get_object_or_404(Article, slug=article_slug, status='pu')
        context['article'] = article
        return context


@api_view(['POST', 'DELETE'])
@drf_permission_classes([permissions.IsAuthenticated])
def toggle_like_article(request, slug):
    """
    API view to toggle like/unlike for an article
    """
    article = get_object_or_404(Article, slug=slug, status='pu')

    if request.method == 'POST':
        # Add like
        try:
            like, created = Like.objects.get_or_create(article=article, user=request.user)
            if created:
                return Response({
                    'status': 'liked',
                    'likes_count': article.likes.count(),
                    'message': 'Лайк добавлен'
                }, status=status.HTTP_201_CREATED)
            else:
                return Response({
                    'status': 'already_liked',
                    'likes_count': article.likes.count(),
                    'message': 'Вы уже поставили лайк этой статье'
                }, status=status.HTTP_200_OK)
        except IntegrityError:
            return Response({
                'status': 'error',
                'message': 'Ошибка при добавлении лайка'
            }, status=status.HTTP_400_BAD_REQUEST)

    elif request.method == 'DELETE':
        # Remove like
        try:
            like = Like.objects.get(article=article, user=request.user)
            like.delete()
            return Response({
                'status': 'unliked',
                'likes_count': article.likes.count(),
                'message': 'Лайк удален'
            }, status=status.HTTP_200_OK)
        except Like.DoesNotExist:
            return Response({
                'status': 'not_liked',
                'likes_count': article.likes.count(),
                'message': 'Вы не ставили лайк этой статье'
            }, status=status.HTTP_404_NOT_FOUND)


@api_view(['GET'])
@drf_permission_classes([permissions.AllowAny])
def article_stats(request, slug):
    """
    API view to get article statistics (likes and comments count)
    """
    article = get_object_or_404(Article, slug=slug, status='pu')

    is_liked = False
    if request.user.is_authenticated:
        is_liked = article.likes.filter(user=request.user).exists()

    return Response({
        'likes_count': article.likes.count(),
        'comments_count': article.comments.filter(is_approved=True).count(),
        'is_liked': is_liked
    })