from rest_framework import serializers
from .models import Article, Category


class CategorySerializer(serializers.ModelSerializer):
    """Serializer for Category model"""
    
    class Meta:
        model = Category
        fields = ['id', 'title', 'slug']
        read_only_fields = ['id', 'slug']


class ArticleSerializer(serializers.ModelSerializer):
    """Serializer for Article model"""
    category = CategorySerializer(read_only=True)
    
    class Meta:
        model = Article
        fields = [
            'id', 
            'title', 
            'preamble', 
            'content', 
            'category', 
            'created', 
            'updated', 
            'slug',
            'keyword'
        ]
        read_only_fields = ['id', 'created', 'updated', 'slug']


class ArticleListSerializer(serializers.ModelSerializer):
    """Simplified serializer for Article list view (without full content)"""
    category = CategorySerializer(read_only=True)
    
    class Meta:
        model = Article
        fields = [
            'id', 
            'title', 
            'preamble', 
            'category', 
            'created', 
            'updated', 
            'slug'
        ]
        read_only_fields = ['id', 'created', 'updated', 'slug']