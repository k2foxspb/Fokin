from rest_framework import generics, permissions
from rest_framework.response import Response
from django.shortcuts import get_object_or_404

from .models import Article, Category
from .serializers import ArticleSerializer, ArticleListSerializer, CategorySerializer


class ArticleListAPIView(generics.ListAPIView):
    """
    API view to retrieve list of published articles
    """
    serializer_class = ArticleListSerializer
    permission_classes = [permissions.AllowAny]  # Allow public access for mobile app
    
    def get_queryset(self):
        # Only return published articles
        return Article.objects.filter(status='pu').select_related('category')


class ArticleDetailAPIView(generics.RetrieveAPIView):
    """
    API view to retrieve a single article by slug
    """
    serializer_class = ArticleSerializer
    permission_classes = [permissions.AllowAny]  # Allow public access for mobile app
    lookup_field = 'slug'
    
    def get_queryset(self):
        # Only return published articles
        return Article.objects.filter(status='pu').select_related('category')


class CategoryListAPIView(generics.ListAPIView):
    """
    API view to retrieve list of published categories
    """
    serializer_class = CategorySerializer
    permission_classes = [permissions.AllowAny]  # Allow public access for mobile app
    
    def get_queryset(self):
        # Only return published categories
        return Category.objects.filter(status='pu')