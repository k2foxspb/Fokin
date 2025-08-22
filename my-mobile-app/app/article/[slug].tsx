import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Dimensions,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  FlatList,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useTheme } from '../../contexts/ThemeContext';
import { API_CONFIG } from '../../config';
import { SafeAreaView } from 'react-native-safe-area-context';

interface Theme {
  background: string;
  surface: string;
  primary: string;
  text: string;
  textSecondary: string;
  border: string;
  headerBackground: string;
  headerText: string;
}

interface Category {
  id: number;
  title: string;
  slug: string;
}

interface Comment {
  id: number;
  content: string;
  author_name: string;
  created: string;
  updated: string;
}

interface Article {
  id: number;
  title: string;
  preamble: string;
  content: string;
  category: Category;
  created: string;
  updated: string;
  slug: string;
  comments: Comment[];
  likes_count: number;
  is_liked: boolean;
  comments_count: number;
}

export default function ArticlePage() {
  const { theme } = useTheme();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);

  const styles = createStyles(theme);

  useEffect(() => {
    fetchArticle();
  }, [slug]);

  useEffect(() => {
    if (article) {
      fetchComments();
    }
  }, [article]);

  const fetchArticle = async () => {
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.get(
        `${API_CONFIG.BASE_URL}/api/articles/${slug}/`,
        { headers: { Authorization: `Token ${token}` } }
      );

      setArticle(response.data);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось загрузить статью');
      router.back();
    } finally {
      setLoading(false);
    }
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

  const toggleLike = async () => {
    if (likeLoading || !article) return;

    setLikeLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const method = article.is_liked ? 'DELETE' : 'POST';
      const response = await axios({
        method,
        url: `${API_CONFIG.BASE_URL}/api/articles/${slug}/like/`,
        headers: { Authorization: `Token ${token}` }
      });

      setArticle(prev => prev ? {
        ...prev,
        is_liked: !prev.is_liked,
        likes_count: response.data.likes_count
      } : null);

    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось изменить статус лайка');
    } finally {
      setLikeLoading(false);
    }
  };

  const fetchComments = async () => {
    if (commentsLoading) return;

    setCommentsLoading(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.get(
        `${API_CONFIG.BASE_URL}/api/articles/${slug}/comments/`,
        { headers: { Authorization: `Token ${token}` } }
      );

      setComments(response.data);
    } catch (error) {
      console.error('Error fetching comments:', error);
      Alert.alert('Ошибка', 'Не удалось загрузить комментарии');
    } finally {
      setCommentsLoading(false);
    }
  };

  const submitComment = async () => {
    if (!newComment.trim() || submittingComment) return;

    setSubmittingComment(true);
    try {
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        router.replace('/(auth)/login');
        return;
      }

      const response = await axios.post(
        `${API_CONFIG.BASE_URL}/api/articles/${slug}/comments/`,
        { content: newComment.trim() },
        { headers: { Authorization: `Token ${token}` } }
      );

      setComments(prev => [response.data, ...prev]);
      setNewComment('');
      setShowCommentModal(false);

      // Обновляем количество комментариев в статье
      setArticle(prev => prev ? {
        ...prev,
        comments_count: prev.comments_count + 1
      } : null);

      Alert.alert('Успешно', 'Комментарий добавлен');
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось добавить комментарий');
    } finally {
      setSubmittingComment(false);
    }
  };

  // Компонент для рендеринга HTML контента
  const HtmlRenderer = ({ html, theme }: { html: string; theme: Theme }) => {
    const screenWidth = Dimensions.get('window').width;

    const isDarkTheme = theme.background === '#000000' || theme.background === '#121212' || theme.text === '#ffffff';
    const textColor = isDarkTheme ? '#ffffff' : '#000000';
    const backgroundColor = 'transparent';
    const secondaryTextColor = isDarkTheme ? '#cccccc' : '#666666';
    const primaryColor = theme.primary || '#007AFF';
    const borderColor = isDarkTheme ? '#333333' : '#e0e0e0';
    const codeBackgroundColor = isDarkTheme ? '#1e1e1e' : '#f5f5f5';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 18px;
            line-height: 1.8;
            color: ${textColor} !important;
            background-color: ${backgroundColor};
            margin: 0;
            padding: 0;
            word-wrap: break-word;
            overflow-wrap: break-word;
            width: 100%;
          }
          p {
            margin: 0 0 16px 0;
            text-align: justify;
            color: ${textColor} !important;
          }
          h1, h2, h3, h4, h5, h6 {
            color: ${textColor} !important;
            margin: 24px 0 12px 0;
            font-weight: bold;
          }
          h1 { font-size: 28px; }
          h2 { font-size: 26px; }
          h3 { font-size: 24px; }
          h4 { font-size: 22px; }
          h5 { font-size: 20px; }
          h6 { font-size: 18px; }
          strong, b { font-weight: bold; color: ${textColor} !important; }
          em, i { font-style: italic; color: ${textColor} !important; }
          ul, ol { margin: 16px 0; padding-left: 24px; }
          li { margin: 6px 0; color: ${textColor} !important; }
          blockquote {
            border-left: 4px solid ${primaryColor};
            margin: 16px 0;
            padding: 12px 20px;
            background-color: ${isDarkTheme ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'};
            font-style: italic;
            color: ${textColor} !important;
          }
          img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
            margin: 16px 0;
          }
          figure {
            margin: 20px 0;
            text-align: center;
          }
          figure img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
          }
          figcaption {
            color: ${secondaryTextColor} !important;
            font-size: 16px;
            margin-top: 12px;
            font-style: italic;
          }
          a { color: ${primaryColor} !important; text-decoration: none; }
          a:hover { text-decoration: underline; }
          pre {
            background-color: ${codeBackgroundColor};
            border: 1px solid ${borderColor};
            border-radius: 8px;
            padding: 16px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            font-size: 16px;
            margin: 16px 0;
            color: ${textColor} !important;
          }
          code {
            background-color: ${codeBackgroundColor};
            border: 1px solid ${borderColor};
            border-radius: 4px;
            padding: 4px 6px;
            font-family: 'Courier New', monospace;
            font-size: 16px;
            color: ${textColor} !important;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }
          th, td {
            border: 1px solid ${borderColor};
            padding: 12px 16px;
            text-align: left;
            color: ${textColor} !important;
          }
          th {
            background-color: ${codeBackgroundColor};
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;

    return (
      <WebView
        source={{ html: htmlContent }}
        style={{ 
          flex: 1,
          backgroundColor: theme.background
        }}
        scrollEnabled={true}
        showsVerticalScrollIndicator={true}
        showsHorizontalScrollIndicator={false}
        onShouldStartLoadWithRequest={() => false}
        javaScriptEnabled={false}
        domStorageEnabled={false}
        androidLayerType="software"
        mixedContentMode="compatibility"
        startInLoadingState={true}
        renderLoading={() => (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={{ color: theme.textSecondary, marginTop: 10 }}>
              Загрузка статьи...
            </Text>
          </View>
        )}
      />
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={theme.headerText} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Загрузка...</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.loadingText}>Загрузка статьи...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!article) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={theme.headerText} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ошибка</Text>
          <View style={{ width: 24 }} />
        </View>
        <View style={styles.loadingContainer}>
          <Text style={styles.errorText}>Статья не найдена</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.headerText} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {article.category.title}
        </Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Контент статьи */}
        <View style={styles.articleContent}>
          <HtmlRenderer html={`
            <div style="padding: 16px; width: 100%; box-sizing: border-box;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <span style="background-color: ${theme.primary}; color: white; padding: 6px 12px; border-radius: 8px; font-size: 14px; font-weight: bold;">
                  ${article.category.title}
                </span>
                <span style="color: ${theme.textSecondary}; font-size: 14px; font-style: italic;">
                  ${formatDate(article.updated)}
                </span>
              </div>

              <h1 style="font-size: 28px; font-weight: bold; color: ${theme.text}; margin-bottom: 16px; line-height: 1.2;">
                ${article.title}
              </h1>

              <div style="padding-bottom: 20px; border-bottom: 1px solid ${theme.border}; margin-bottom: 20px;">
                <div style="margin-bottom: 8px; font-size: 14px; color: ${theme.textSecondary};">
                  📅 Создано: ${formatDate(article.created)}
                </div>
                ${article.updated !== article.created ? `
                  <div style="font-size: 14px; color: ${theme.textSecondary};">
                    🔄 Обновлено: ${formatDate(article.updated)}
                  </div>
                ` : ''}
              </div>

              ${article.content}
            </div>
          `} theme={theme} />
        </View>

        {/* Панель лайков и комментариев */}
        <View style={styles.actionsPanel}>
          <TouchableOpacity 
            style={[styles.actionButton, article.is_liked && styles.likedButton]}
            onPress={toggleLike}
            disabled={likeLoading}
          >
            <Ionicons 
              name={article.is_liked ? "heart" : "heart-outline"} 
              size={20} 
              color={article.is_liked ? "white" : theme.primary} 
            />
            <Text style={[
              styles.actionButtonText, 
              article.is_liked && styles.likedButtonText
            ]}>
              {likeLoading ? '...' : article.likes_count}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => setShowCommentModal(true)}
          >
            <Ionicons name="chatbubble-outline" size={20} color={theme.primary} />
            <Text style={styles.actionButtonText}>{article.comments_count}</Text>
          </TouchableOpacity>
        </View>

        {/* Секция комментариев */}
        <View style={styles.commentsSection}>
          <View style={styles.commentsSectionHeader}>
            <Text style={styles.commentsSectionTitle}>
              Комментарии ({article.comments_count})
            </Text>
            <TouchableOpacity 
              style={styles.addCommentButton}
              onPress={() => setShowCommentModal(true)}
            >
              <Ionicons name="add" size={20} color="white" />
              <Text style={styles.addCommentButtonText}>Добавить</Text>
            </TouchableOpacity>
          </View>

          {commentsLoading ? (
            <View style={styles.commentsLoading}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={styles.loadingText}>Загрузка комментариев...</Text>
            </View>
          ) : comments.length > 0 ? (
            <FlatList
              data={comments}
              keyExtractor={(item) => item.id.toString()}
              renderItem={({ item }) => (
                <View style={styles.commentItem}>
                  <View style={styles.commentHeader}>
                    <Text style={styles.commentAuthor}>{item.author_name}</Text>
                    <Text style={styles.commentDate}>{formatDate(item.created)}</Text>
                  </View>
                  <Text style={styles.commentContent}>{item.content}</Text>
                </View>
              )}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.commentSeparator} />}
            />
          ) : (
            <View style={styles.noCommentsContainer}>
              <Ionicons name="chatbubbles-outline" size={48} color={theme.textSecondary} />
              <Text style={styles.noCommentsText}>Пока нет комментариев</Text>
              <Text style={styles.noCommentsSubtext}>Будьте первым, кто оставит комментарий!</Text>
            </View>
          )}
        </View>

        {/* Модальное окно для добавления комментария */}
        <Modal
          visible={showCommentModal}
          animationType="slide"
          presentationStyle="pageSheet"
          onRequestClose={() => setShowCommentModal(false)}
        >
          <SafeAreaView style={styles.modalContainer}>
            <KeyboardAvoidingView 
              style={styles.modalContent} 
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <View style={styles.modalHeader}>
                <TouchableOpacity onPress={() => setShowCommentModal(false)}>
                  <Text style={styles.modalCancelButton}>Отмена</Text>
                </TouchableOpacity>
                <Text style={styles.modalTitle}>Новый комментарий</Text>
                <TouchableOpacity 
                  onPress={submitComment}
                  disabled={!newComment.trim() || submittingComment}
                >
                  <Text style={[
                    styles.modalSubmitButton,
                    (!newComment.trim() || submittingComment) && styles.modalSubmitButtonDisabled
                  ]}>
                    {submittingComment ? 'Отправка...' : 'Отправить'}
                  </Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.commentInput}
                multiline
                numberOfLines={6}
                placeholder="Напишите ваш комментарий..."
                placeholderTextColor={theme.textSecondary}
                value={newComment}
                onChangeText={setNewComment}
                textAlignVertical="top"
                maxLength={500}
              />

              <Text style={styles.characterCount}>
                {newComment.length}/500
              </Text>
            </KeyboardAvoidingView>
          </SafeAreaView>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: theme.headerBackground,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.headerText,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 16,
  },
  content: {
    flex: 1,
  },
  articleContent: {
    minHeight: 400,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: theme.textSecondary,
  },
  errorText: {
    fontSize: 18,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  actionsPanel: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.border,
    marginBottom: 20,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: theme.background,
    borderWidth: 1,
    borderColor: theme.primary,
    minWidth: 80,
    justifyContent: 'center',
  },
  likedButton: {
    backgroundColor: theme.primary,
    borderColor: theme.primary,
  },
  actionButtonText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.primary,
  },
  likedButtonText: {
    color: 'white',
  },
  commentsSection: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  commentsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  commentsSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  addCommentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  addCommentButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  commentsLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
  },
  commentItem: {
    backgroundColor: theme.surface,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  commentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  commentAuthor: {
    fontSize: 14,
    fontWeight: 'bold',
    color: theme.primary,
  },
  commentDate: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  commentContent: {
    fontSize: 14,
    color: theme.text,
    lineHeight: 20,
  },
  commentSeparator: {
    height: 12,
  },
  noCommentsContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  noCommentsText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.textSecondary,
    marginTop: 12,
  },
  noCommentsSubtext: {
    fontSize: 14,
    color: theme.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: theme.background,
  },
  modalContent: {
    flex: 1,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.text,
  },
  modalCancelButton: {
    fontSize: 16,
    color: theme.textSecondary,
  },
  modalSubmitButton: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.primary,
  },
  modalSubmitButtonDisabled: {
    color: theme.textSecondary,
  },
  commentInput: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.surface,
    minHeight: 120,
  },
  characterCount: {
    fontSize: 12,
    color: theme.textSecondary,
    textAlign: 'right',
    marginTop: 8,
  },
  articleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingBottom: 8,
  },
  categoryContainer: {
    backgroundColor: theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  categoryText: {
    color: 'white',
    fontSize: 14,
    fontWeight: 'bold',
  },
  dateText: {
    fontSize: 14,
    color: theme.textSecondary,
    fontStyle: 'italic',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.text,
    paddingHorizontal: 16,
    paddingBottom: 16,
    lineHeight: 34,
  },
  articleMeta: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    marginBottom: 20,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  metaText: {
    fontSize: 14,
    color: theme.textSecondary,
    marginLeft: 8,
  },
  htmlContainer: {
    flex: 1,
  },
});
