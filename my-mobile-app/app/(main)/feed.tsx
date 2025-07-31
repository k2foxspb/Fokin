import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  ScrollView
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import { API_CONFIG } from "../../config";

interface Category {
  id: number;
  title: string;
  slug: string;
}

interface Article {
  id: number;
  title: string;
  preamble: string;
  content?: string;
  category: Category;
  created: string;
  updated: string;
  slug: string;
  isLoading?: boolean;
  loadError?: boolean;
}

export default function Feed() {
  const { theme } = useTheme();
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedArticleIds, setExpandedArticleIds] = useState<number[]>([]);

  // Создаем стили сразу, используя тему
  const styles = createStyles(theme);

  const fetchArticles = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.get(`${API_CONFIG.BASE_URL}/api/articles/`, {
        headers: { Authorization: `Token ${token}` }
      });

      setArticles(response.data);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось загрузить новости');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchArticles();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const stripHtml = (html: string) => {
    return html.replace(/<[^>]*>/g, '');
  };

  const toggleArticleExpansion = async (article: Article) => {
    const isExpanded = expandedArticleIds.includes(article.id);

    if (isExpanded) {
      setExpandedArticleIds(expandedArticleIds.filter(id => id !== article.id));
    } else {
      if (!article.content) {
        const updatedArticles = articles.map(a =>
          a.id === article.id ? { ...a, isLoading: true } : a
        );
        setArticles(updatedArticles);

        try {
          const token = await AsyncStorage.getItem('userToken');
          if (!token) {
            const updatedArticles = articles.map(a =>
              a.id === article.id ? { ...a, isLoading: false } : a
            );
            setArticles(updatedArticles);
            router.replace('/(auth)/login');
            return;
          }

          const response = await axios.get(
            `${API_CONFIG.BASE_URL}/api/articles/${article.slug}/`,
            { headers: { Authorization: `Token ${token}` } }
          );

          const updatedArticles = articles.map(a =>
            a.id === article.id ? { ...a, content: response.data.content, isLoading: false } : a
          );
          setArticles(updatedArticles);
        } catch (error) {
          const updatedArticles = articles.map(a =>
            a.id === article.id ? { ...a, isLoading: false, loadError: true } : a
          );
          setArticles(updatedArticles);
          console.error('Error fetching article content:', error);
        }
      }

      setExpandedArticleIds([...expandedArticleIds, article.id]);
    }
  };

  useEffect(() => {
    fetchArticles();
  }, []);

  const renderArticle = ({ item }: { item: Article }) => {
    const isExpanded = expandedArticleIds.includes(item.id);

    return (
      <TouchableOpacity
        style={[styles.articleItem, isExpanded && styles.expandedArticleItem]}
        onPress={() => toggleArticleExpansion(item)}
        activeOpacity={0.7}
      >
        <View style={styles.articleHeader}>
          <View style={styles.categoryContainer}>
            <Text style={styles.categoryText}>{item.category.title}</Text>
          </View>
          <Text style={[styles.dateText, { color: theme.textSecondary }]}>{formatDate(item.updated)}</Text>
        </View>

        <Text style={[styles.articleTitle, { color: theme.text }]}>{item.title}</Text>

        {isExpanded ? (
          <View style={[styles.expandedContent, { borderTopColor: theme.border, borderBottomColor: theme.border }]}>
            {item.content ? (
              <Text style={[styles.articleContent, { color: theme.text }]}>
                {stripHtml(item.content)}
              </Text>
            ) : (
              <View>
                <Text style={[styles.articlePreamble, { color: theme.textSecondary }]}>
                  {stripHtml(item.preamble)}
                </Text>
                {item.isLoading ? (
                  <ActivityIndicator style={styles.contentLoader} color={theme.primary} />
                ) : item.loadError ? (
                  <Text style={[styles.noContentText, { color: theme.error }]}>
                    Не удалось загрузить полный текст статьи
                  </Text>
                ) : (
                  <Text style={[styles.waitingText, { color: theme.textSecondary }]}>
                    Нажмите, чтобы загрузить полный текст
                  </Text>
                )}
              </View>
            )}
          </View>
        ) : (
          <Text style={[styles.articlePreamble, { color: theme.textSecondary }]} numberOfLines={3}>
            {stripHtml(item.preamble)}
          </Text>
        )}

        <View style={[styles.articleFooter, { borderTopColor: theme.borderLight }]}>
          <View style={styles.footerLeft}>
            <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
            <Text style={[styles.footerText, { color: theme.textSecondary }]}>
              {formatDate(item.created)}
            </Text>
          </View>

          <View style={[styles.expandIndicator, { backgroundColor: theme.primary + '10' }]}>
            <Ionicons
              name={isExpanded ? "chevron-up-outline" : "chevron-down-outline"}
              size={20}
              color={theme.primary}
            />
            <Text style={[styles.expandText, { color: theme.primary }]}>
              {isExpanded ? "Свернуть" : "Подробнее"}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={styles.loadingText}>Загрузка новостей...</Text>
      </View>
    );
  }

  if (articles.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="newspaper-outline" size={64} color={theme.textSecondary} />
        <Text style={styles.emptyText}>Новостей пока нет</Text>
        <TouchableOpacity style={styles.refreshButton} onPress={fetchArticles}>
          <Text style={styles.refreshButtonText}>Обновить</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={articles}
        renderItem={renderArticle}
        keyExtractor={(item) => item.id.toString()}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.primary]}
            tintColor={theme.primary}
          />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContainer}
      />
    </View>
  );
}

// Функция создания стилей вынесена вниз
const createStyles = (theme: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.background,
  },
  loadingText: {
    marginTop: 8,
    color: theme.textSecondary,
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: theme.background,
  },
  emptyText: {
    fontSize: 18,
    color: theme.textSecondary,
    marginTop: 16,
    marginBottom: 20,
  },
  refreshButton: {
    backgroundColor: theme.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    elevation: 2,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  listContainer: {
    padding: 16,
  },
  articleItem: {
    backgroundColor: theme.surface,
    padding: 18,
    marginBottom: 16,
    borderRadius: 16,
    elevation: 3,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  expandedArticleItem: {
    backgroundColor: theme.surfacePressed,
    borderColor: theme.primary,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
    borderWidth: 2,
  },
  articleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryContainer: {
    backgroundColor: theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    elevation: 1,
    shadowColor: theme.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  categoryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  dateText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  articleTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 12,
    lineHeight: 28,
  },
  articlePreamble: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 15,
  },
  expandedContent: {
    marginVertical: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  articleContent: {
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 15,
    textAlign: 'justify',
  },
  articleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    marginLeft: 4,
  },
  expandIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  expandText: {
    fontSize: 14,
    marginLeft: 4,
    fontWeight: '600',
  },
  contentLoader: {
    marginVertical: 12,
  },
  noContentText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 12,
  },
  waitingText: {
    fontSize: 14,
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 12,
  },
});