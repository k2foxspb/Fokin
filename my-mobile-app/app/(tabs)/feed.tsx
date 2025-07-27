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
import {API_CONFIG} from "../../config";

interface Category {
  id: number;
  title: string;
  slug: string;
}

interface Article {
  id: number;
  title: string;
  preamble: string;
  content?: string; // Optional content field for expanded articles
  category: Category;
  created: string;
  updated: string;
  slug: string;
  isLoading?: boolean; // Flag to indicate if article content is being loaded
  loadError?: boolean; // Flag to indicate if there was an error loading the content
}

export default function Feed() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedArticleIds, setExpandedArticleIds] = useState<number[]>([]);

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
    // Check if article is already expanded
    const isExpanded = expandedArticleIds.includes(article.id);
    
    if (isExpanded) {
      // Collapse the article
      setExpandedArticleIds(expandedArticleIds.filter(id => id !== article.id));
    } else {
      // Expand the article - fetch content if not already loaded
      if (!article.content) {
        // Create a local loading state for this specific article
        const updatedArticles = articles.map(a => 
          a.id === article.id ? { ...a, isLoading: true } : a
        );
        setArticles(updatedArticles);
        
        try {
          const token = await AsyncStorage.getItem('userToken');
          if (!token) {
            // Update article to remove loading state
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
          
          // Update the article with content and remove loading state
          const updatedArticles = articles.map(a => 
            a.id === article.id ? { ...a, content: response.data.content, isLoading: false } : a
          );
          setArticles(updatedArticles);
        } catch (error) {
          // Update article to remove loading state but mark as error
          const updatedArticles = articles.map(a => 
            a.id === article.id ? { ...a, isLoading: false, loadError: true } : a
          );
          setArticles(updatedArticles);
          console.error('Error fetching article content:', error);
        }
      }
      
      // Add article id to expanded list
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
          <Text style={styles.dateText}>{formatDate(item.updated)}</Text>
        </View>

        <Text style={styles.articleTitle}>{item.title}</Text>
        
        {isExpanded ? (
          <View style={styles.expandedContent}>
            {item.content ? (
              <Text style={styles.articleContent}>
                {stripHtml(item.content)}
              </Text>
            ) : (
              <View>
                <Text style={styles.articlePreamble}>
                  {stripHtml(item.preamble)}
                </Text>
                {item.isLoading ? (
                  <ActivityIndicator style={styles.contentLoader} color="#007AFF" />
                ) : item.loadError ? (
                  <Text style={styles.noContentText}>
                    Не удалось загрузить полный текст статьи
                  </Text>
                ) : (
                  <Text style={styles.waitingText}>
                    Нажмите, чтобы загрузить полный текст
                  </Text>
                )}
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.articlePreamble} numberOfLines={3}>
            {stripHtml(item.preamble)}
          </Text>
        )}

        <View style={styles.articleFooter}>
          <View style={styles.footerLeft}>
            <Ionicons name="time-outline" size={16} color="#666" />
            <Text style={styles.footerText}>
              {formatDate(item.created)}
            </Text>
          </View>
          
          <View style={styles.expandIndicator}>
            <Ionicons 
              name={isExpanded ? "chevron-up-outline" : "chevron-down-outline"} 
              size={20} 
              color="#007AFF" 
            />
            <Text style={styles.expandText}>
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
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Загрузка новостей...</Text>
      </View>
    );
  }

  if (articles.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="newspaper-outline" size={64} color="#ccc" />
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContainer}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    color: '#666',
    fontSize: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 18,
    color: '#666',
    marginTop: 16,
    marginBottom: 20,
  },
  refreshButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  listContainer: {
    padding: 16,
  },
  articleItem: {
    backgroundColor: 'white',
    padding: 16,
    marginBottom: 16,
    borderRadius: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  expandedArticleItem: {
    backgroundColor: '#f9f9ff',
    borderColor: '#e0e0ff',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  articleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  categoryContainer: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  categoryText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  dateText: {
    fontSize: 12,
    color: '#666',
    fontStyle: 'italic',
  },
  articleTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    lineHeight: 26,
  },
  articlePreamble: {
    fontSize: 15,
    color: '#555',
    lineHeight: 22,
    marginBottom: 15,
  },
  expandedContent: {
    marginVertical: 10,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: '#eaeaea',
    borderBottomWidth: 1,
    borderBottomColor: '#eaeaea',
  },
  articleContent: {
    fontSize: 16,
    color: '#333',
    lineHeight: 24,
    marginBottom: 15,
    textAlign: 'justify',
  },
  articleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#666',
    marginLeft: 4,
  },
  expandIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expandText: {
    fontSize: 14,
    color: '#007AFF',
    marginLeft: 4,
    fontWeight: '500',
  },
  contentLoader: {
    marginVertical: 10,
  },
  noContentText: {
    fontSize: 14,
    color: '#ff6b6b',
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 10,
  },
  waitingText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 10,
  },
});
