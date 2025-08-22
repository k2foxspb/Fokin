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
                console.error('Ошибка проверки токена:', error);
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

    // Компонент для рендеринга HTML контента
    const HtmlRenderer = ({html, theme}: { html: string; theme: Theme }) => {
        const screenWidth = Dimensions.get('window').width - 70; // Увеличиваем отступы для безопасности

        // Определяем цвета на основе темы
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
                    * {
                        box-sizing: border-box;
                    }

                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        font-size: 16px;
                        line-height: 1.6;
                        color: ${textColor} !important;
                        background-color: ${backgroundColor};
                        margin: 0;
                        padding: 8px;
                        word-wrap: break-word;
                        overflow-wrap: break-word;
                        max-width: 100%;
                    }

                    p {
                        margin: 0 0 12px 0;
                        text-align: justify;
                        color: ${textColor} !important;
                    }

                    h1, h2, h3, h4, h5, h6 {
                        color: ${textColor} !important;
                        margin: 16px 0 8px 0;
                        font-weight: bold;
                    }

                    h1 { font-size: 24px; }
                    h2 { font-size: 22px; }
                    h3 { font-size: 20px; }
                    h4 { font-size: 18px; }
                    h5 { font-size: 16px; }
                    h6 { font-size: 14px; }

                    strong, b {
                        font-weight: bold;
                        color: ${textColor} !important;
                    }

                    em, i {
                        font-style: italic;
                        color: ${textColor} !important;
                    }

                    ul, ol {
                        margin: 12px 0;
                        padding-left: 20px;
                    }

                    li {
                        margin: 4px 0;
                        color: ${textColor} !important;
                    }

                    blockquote {
                        border-left: 4px solid ${primaryColor};
                        margin: 12px 0;
                        padding: 8px 16px;
                        background-color: ${isDarkTheme ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)'};
                        font-style: italic;
                        color: ${textColor} !important;
                    }

                    img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 8px;
                        margin: 8px 0;
                    }

                    figure {
                        margin: 16px 0;
                        text-align: center;
                    }

                    figure img {
                        max-width: 100%;
                        height: auto;
                        border-radius: 8px;
                    }

                    figcaption {
                        color: ${secondaryTextColor} !important;
                        font-size: 14px;
                        margin-top: 8px;
                        font-style: italic;
                    }

                    a {
                        color: ${primaryColor} !important;
                        text-decoration: none;
                    }

                    a:hover {
                        text-decoration: underline;
                    }

                    pre {
                        background-color: ${codeBackgroundColor};
                        border: 1px solid ${borderColor};
                        border-radius: 6px;
                        padding: 12px;
                        overflow-x: auto;
                        font-family: 'Courier New', monospace;
                        font-size: 14px;
                        margin: 12px 0;
                        color: ${textColor} !important;
                    }

                    code {
                        background-color: ${codeBackgroundColor};
                        border: 1px solid ${borderColor};
                        border-radius: 3px;
                        padding: 2px 4px;
                        font-family: 'Courier New', monospace;
                        font-size: 14px;
                        color: ${textColor} !important;
                    }

                    table {
                        width: 100%;
                        border-collapse: collapse;
                        margin: 16px 0;
                    }

                    th, td {
                        border: 1px solid ${borderColor};
                        padding: 8px 12px;
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
                source={{html: htmlContent}}
                style={{
                    width: screenWidth,
                    height: 800, // Увеличенная высота для полного контента
                    backgroundColor: 'transparent'
                }}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                onShouldStartLoadWithRequest={() => false}
                javaScriptEnabled={false}
                androidLayerType="software"
                mixedContentMode="compatibility"
                nestedScrollEnabled={false}
            />
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
                    console.error('Error fetching article content:', error);
                }
            }

            setExpandedArticleIds([...expandedArticleIds, article.id]);
        }
    };

    useEffect(() => {
        fetchArticles();
    }, []);


    const renderArticle = ({item}: { item: Article }) => {
        return (
            <TouchableOpacity 
                style={[styles.articleItem]}
                onPress={() => router.push(`/article/${item.slug}`)}
                activeOpacity={0.8}
            >
                {/* Категория */}
                <View style={styles.categoryContainer}>
                    <Text style={styles.categoryText}>{item.category.title}</Text>
                </View>

                {/* Заголовок - отцентрованный */}
                <Text style={[styles.articleTitle, {color: theme.text}]}>{item.title}</Text>

                {/* Преамбула */}
                <Text style={[styles.articlePreamble, {color: theme.textSecondary}]} numberOfLines={4}>
                    {stripHtml(item.preamble)}
                </Text>

                {/* Даты */}
                <View style={styles.datesContainer}>
                    <View style={styles.dateRow}>
                        <Ionicons name="calendar-outline" size={14} color={theme.textSecondary}/>
                        <Text style={[styles.dateLabel, {color: theme.textSecondary}]}>Создано:</Text>
                        <Text style={[styles.dateValue, {color: theme.textSecondary}]}>
                            {formatDate(item.created)}
                        </Text>
                    </View>

                    {item.updated !== item.created && (
                        <View style={styles.dateRow}>
                            <Ionicons name="create-outline" size={14} color={theme.textSecondary}/>
                            <Text style={[styles.dateLabel, {color: theme.textSecondary}]}>Изменено:</Text>
                            <Text style={[styles.dateValue, {color: theme.textSecondary}]}>
                                {formatDate(item.updated)}
                            </Text>
                        </View>
                    )}
                </View>

                {/* Кнопка "Читать полностью" */}
                <View style={[styles.readMoreButton, {backgroundColor: theme.primary}]}>
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