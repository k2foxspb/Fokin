from rest_framework import serializers
from .models import Article, Category, Comment, Like


class CategorySerializer(serializers.ModelSerializer):
    """Serializer for Category model"""

    class Meta:
        model = Category
        fields = ['id', 'title', 'slug']
        read_only_fields = ['id', 'slug']


class CommentSerializer(serializers.ModelSerializer):
    """Serializer for Comment model"""
    author_name = serializers.CharField(source='author.username', read_only=True)

    class Meta:
        model = Comment
        fields = ['id', 'content', 'author_name', 'created', 'updated']
        read_only_fields = ['id', 'author_name', 'created', 'updated']


class CommentCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating comments"""

    class Meta:
        model = Comment
        fields = ['content']

    def create(self, validated_data):
        validated_data['author'] = self.context['request'].user
        validated_data['article'] = self.context['article']
        return super().create(validated_data)


class LikeSerializer(serializers.ModelSerializer):
    """Serializer for Like model"""
    user_name = serializers.CharField(source='user.username', read_only=True)

    class Meta:
        model = Like
        fields = ['id', 'user_name', 'created']
        read_only_fields = ['id', 'user_name', 'created']


class ArticleSerializer(serializers.ModelSerializer):
    """Serializer for Article model"""
    category = CategorySerializer(read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    likes_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()

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
            'keyword',
            'comments',
            'likes_count',
            'is_liked',
            'comments_count'
        ]
        read_only_fields = ['id', 'created', 'updated', 'slug']

    def get_likes_count(self, obj):
        return obj.likes.count()

    def get_is_liked(self, obj):
        user = self.context.get('request').user if self.context.get('request') else None
        if user and user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False

    def get_comments_count(self, obj):
        return obj.comments.filter(is_approved=True).count()


class ArticleListSerializer(serializers.ModelSerializer):
    """Simplified serializer for Article list view (without full content)"""
    category = CategorySerializer(read_only=True)
    likes_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = [
            'id', 
            'title', 
            'preamble', 
            'category', 
            'created', 
            'updated', 
            'slug',
            'likes_count',
            'is_liked',
            'comments_count'
        ]
        read_only_fields = ['id', 'created', 'updated', 'slug']

    def get_likes_count(self, obj):
        return obj.likes.count()

    def get_is_liked(self, obj):
        user = self.context.get('request').user if self.context.get('request') else None
        if user and user.is_authenticated:
            return obj.likes.filter(user=user).exists()
        return False

    def get_comments_count(self, obj):
        return obj.comments.filter(is_approved=True).count()