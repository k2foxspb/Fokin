import React, {useState, useEffect} from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    ActivityIndicator,
    RefreshControl,
    Alert,
    Dimensions
} from 'react-native';
import {router} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
import {WebView} from 'react-native-webview';
import {useTheme} from '../../contexts/ThemeContext';
import {useNotifications} from '../../contexts/NotificationContext';
import {API_CONFIG} from "../../config";

interface Theme {
    background: string;
    surface: string;
    surfacePressed: string;
    primary: string;
    text: string;
    textSecondary: string;
    border: string;
    error?: string;
}

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
    const {theme} = useTheme();
    const {requestPermissions, debugInfo} = useNotifications(); // Используем контекст
    const [articles, setArticles] = useState<Article[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [expandedArticleIds, setExpandedArticleIds] = useState<number[]>([]);

    // Создаем стили сразу, используя тему
    const styles = createStyles(theme);

    // Проверка аутентификации при загрузке компонента
    useEffect(() => {
        const checkAuth = async () => {
            try {
                const token = await AsyncStorage.getItem('userToken');
                if (!token) {
                    router.replace('/(auth)/login');
                    return;
                }
            } catch (error) {
                // Ошибка проверки токена
                router.replace('/(auth)/login');
            }
        };

        checkAuth();
    }, []);

    // Запрос разрешений на уведомления при первом запуске
    useEffect(() => {
        const setupNotifications = async () => {
            if (debugInfo && !debugInfo.hasPermission) {
                Alert.alert(
                    'Уведомления',
                    'Разрешите уведомления, чтобы получать информацию о новых сообщениях',
                    [
                        {text: 'Позже', style: 'cancel'},
                        {text: 'Разрешить', onPress: () => requestPermissions()}
                    ]
                );
            }
        };

        const timer = setTimeout(setupNotifications, 2000);
        return () => clearTimeout(timer);
    }, [debugInfo?.hasPermission, requestPermissions]);

    const fetchArticles = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                router.replace('/(auth)/login');
                return;
            }

            const response = await axios.get(`${API_CONFIG.BASE_URL}/api/articles/`, {
                headers: {Authorization: `Token ${token}`}
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

    const formatDate = (dateString: string | null | undefined) => {
        if (!dateString) return 'Не указано';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'Неверная дата';
            return date.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return 'Ошибка даты';
        }
    };

    const stripHtml = (html: string | null | undefined) => {
        if (!html || typeof html !== 'string') return '';
        try {
            return html.replace(/<[^>]*>/g, '');
        } catch {
            return '';
        }
    };

    // Простой компонент для отображения HTML как текста
    const HtmlRenderer = ({html, theme}: { html: string; theme: Theme }) => {
        if (!html) {
            return <Text style={{color: theme?.text || '#000'}}>Контент недоступен</Text>;
        }

        // Простое отображение очищенного HTML как текста
        const cleanText = stripHtml(html);

        return (
            <Text style={{
                fontSize: 16,
                lineHeight: 24,
                color: theme?.text || '#000',
                textAlign: 'justify',
                padding: 8
            }}>
                {cleanText}
            </Text>
        );
    };

    const toggleArticleExpansion = async (article: Article) => {
        const isExpanded = expandedArticleIds.includes(article.id);

        if (isExpanded) {
            setExpandedArticleIds(expandedArticleIds.filter(id => id !== article.id));
        } else {
            if (!article.content) {
                const updatedArticles = articles.map(a =>
                    a.id === article.id ? {...a, isLoading: true} : a
                );
                setArticles(updatedArticles);

                try {
                    const token = await AsyncStorage.getItem('userToken');
                    if (!token) {
                        const updatedArticles = articles.map(a =>
                            a.id === article.id ? {...a, isLoading: false} : a
                        );
                        setArticles(updatedArticles);
                        router.replace('/(auth)/login');
                        return;
                    }

                    const response = await axios.get(
                        `${API_CONFIG.BASE_URL}/api/articles/${article.slug}/`,
                        {headers: {Authorization: `Token ${token}`}}
                    );

                    const updatedArticles = articles.map(a =>
                        a.id === article.id ? {...a, content: response.data.content, isLoading: false} : a
                    );
                    setArticles(updatedArticles);
                } catch (error) {
                    const updatedArticles = articles.map(a =>
                        a.id === article.id ? {...a, isLoading: false, loadError: true} : a
                    );
                    setArticles(updatedArticles);
                    // Ошибка получения контента статьи
                }
            }

            setExpandedArticleIds([...expandedArticleIds, article.id]);
        }
    };

    useEffect(() => {
        fetchArticles();
    }, []);


    const renderArticle = ({item}: { item: Article }) => {
        if (!item) return null;

        return (
            <TouchableOpacity
                style={[styles.articleItem]}
                onPress={() => router.push(`/article/${item.slug || 'unknown'}`)}
                activeOpacity={0.8}
            >
                {/* Категория */}
                <View style={styles.categoryContainer}>
                    <Text style={styles.categoryText}>
                        {item.category?.title || 'Без категории'}
                    </Text>
                </View>

                {/* Заголовок - отцентрованный */}
                <Text style={[styles.articleTitle, {color: theme?.text || '#000'}]}>
                    {item.title || 'Без названия'}
                </Text>

                {/* Преамбула */}
                <Text style={[styles.articlePreamble, {color: theme?.textSecondary || '#666'}]} numberOfLines={4}>
                    {stripHtml(item.preamble)}
                </Text>

                {/* Даты */}
                <View style={styles.datesContainer}>
                    <View style={styles.dateRow}>
                        <Ionicons name="calendar-outline" size={14} color={theme?.textSecondary || '#666'}/>
                        <Text style={[styles.dateLabel, {color: theme?.textSecondary || '#666'}]}>Создано:</Text>
                        <Text style={[styles.dateValue, {color: theme?.textSecondary || '#666'}]}>
                            {formatDate(item.created)}
                        </Text>
                    </View>

                    {item.updated && item.updated !== item.created && (
                        <View style={styles.dateRow}>
                            <Ionicons name="create-outline" size={14} color={theme?.textSecondary || '#666'}/>
                            <Text style={[styles.dateLabel, {color: theme?.textSecondary || '#666'}]}>Изменено:</Text>
                            <Text style={[styles.dateValue, {color: theme?.textSecondary || '#666'}]}>
                                {formatDate(item.updated)}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Кнопка "Читать полностью" */}
                <View style={[styles.readMoreButton, {backgroundColor: theme?.primary || '#007AFF'}]}>
                    <Ionicons name="book-outline" size={16} color="white"/>
                    <Text style={styles.readMoreButtonText}>Читать полностью</Text>
                </View>
            </TouchableOpacity>
        );
    };

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary}/>
                <Text style={styles.loadingText}>Загрузка новостей...</Text>
            </View>
        );
    }

    if (articles.length === 0) {
        return (
            <View style={styles.emptyContainer}>
                <Ionicons name="newspaper-outline" size={64} color={theme.textSecondary}/>
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
                keyExtractor={(item, index) => {
                    if (item && item.id != null) {
                        return String(item.id);
                    }
                    return String(index);
                }}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefresh}
                        colors={[theme?.primary || '#007AFF']}
                        tintColor={theme?.primary || '#007AFF'}
                    />
                }
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContainer}
            />
        </View>
    );
}

// Функция создания стилей
const createStyles = (theme: Theme) => StyleSheet.create({
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
        shadowOffset: {width: 0, height: 2},
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
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 6,
        borderWidth: 1,
        borderColor: theme.border,
    },
    categoryContainer: {
        backgroundColor: theme.primary,
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        alignSelf: 'center',
        marginBottom: 12,
        elevation: 1,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    categoryText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
        textAlign: 'center',
    },
    articleTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 12,
        lineHeight: 26,
        textAlign: 'center',
    },
    articlePreamble: {
        fontSize: 15,
        lineHeight: 22,
        marginBottom: 16,
        textAlign: 'justify',
    },
    datesContainer: {
        marginBottom: 16,
    },
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    dateLabel: {
        fontSize: 12,
        marginLeft: 6,
        marginRight: 4,
        fontWeight: '500',
    },
    dateValue: {
        fontSize: 12,
        fontWeight: '400',
    },
    readMoreButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    readMoreButtonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: 'bold',
        marginLeft: 6,
    },
});