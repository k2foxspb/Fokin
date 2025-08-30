import React, {useState, useEffect} from 'react';
import TabBar from '../../components/TabBar';

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
import {router, useLocalSearchParams} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
import CachedImage from '../../components/CachedImage';
import AlbumCreateModal from '../../components/AlbumCreateModal';
import AlbumEditModal from '../../components/AlbumEditModal';
import {API_CONFIG} from "../../config";
import { useTheme } from '../../contexts/ThemeContext';

const {width} = Dimensions.get('window');
const albumWidth = (width - 48) / 2; // 2 columns with margins

interface Photo {
    id: number;
    image_url: string;
    thumbnail_url: string;
    caption: string;
    uploaded_at: string;
}

interface Album {
    id: number;
    title: string;
    hidden_flag: boolean;
    created_at: string;
    photos_count: number;
    cover_photo: Photo | null;
}

export default function UserAlbums() {
    const { theme } = useTheme();
    const {username} = useLocalSearchParams<{ username: string }>();
    const [albums, setAlbums] = useState<Album[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [currentUser, setCurrentUser] = useState<string | null>(null);
    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);

    const styles = createStyles(theme);

    const getCurrentUser = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) return;

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/profile/api/current-user/`,
                {
                    headers: {Authorization: `Token ${token}`}
                }
            );
            setCurrentUser(response.data.username);
        } catch (error) {
            // Ошибка получения текущего пользователя
        }
    };

    const fetchAlbums = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                router.replace('/(auth)/login');
                return;
            }

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/photo/api/user/${username}/albums/`,
                {
                    headers: {Authorization: `Token ${token}`}
                }
            );

            setAlbums(response.data);
        } catch (error) {
            Alert.alert('Ошибка', 'Не удалось загрузить альбомы');
            router.back();
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchAlbums();
    };

    useEffect(() => {
        if (username) {
            getCurrentUser();
            fetchAlbums();
        }
    }, [username]);

    const handleAlbumPress = (albumId: number) => {
        router.push(`/album/${albumId}`);
    };

    const handleAlbumLongPress = (album: Album) => {
        // Only allow editing own albums
        if (currentUser === username) {
            setSelectedAlbum(album);
            setEditModalVisible(true);
        }
    };

    const handleAlbumUpdated = () => {
        fetchAlbums();
    };

    const handleAlbumDeleted = () => {
        fetchAlbums();
        router.back(); // Go back if we're viewing the deleted album's owner
    };

    const renderAlbum = ({item}: { item: Album }) => (
        <TouchableOpacity
            style={styles.albumItem}
            onPress={() => handleAlbumPress(item.id)}
            onLongPress={() => handleAlbumLongPress(item)}
            activeOpacity={0.8}
        >
            <View style={styles.albumCover}>
                {item.cover_photo ? (
                        <CachedImage
                            uri={item.cover_photo.thumbnail_url}
                        style={styles.coverImage}
                        resizeMode="cover"
                    />
                ) : (
                    <View style={styles.emptyCover}>
                        <Ionicons name="images-outline" size={40} color={theme.textSecondary}/>
                    </View>
                )}

                {item.hidden_flag && (
                    <View style={styles.hiddenBadge}>
                        <Ionicons name="eye-off" size={16} color="white"/>
                    </View>
                )}

                <View style={styles.photoCount}>
                    <Text style={styles.photoCountText}>{item.photos_count}</Text>
                </View>
            </View>

            <View style={styles.albumInfo}>
                <Text style={styles.albumTitle} numberOfLines={2}>
                    {item.title}
                </Text>
                <Text style={styles.albumDate}>
                    {new Date(item.created_at).toLocaleDateString('ru-RU')}
                </Text>
            </View>
        </TouchableOpacity>
    );

    if (loading) {
        return (
            <>
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.primary}/>
                    <Text style={styles.loadingText}>Загрузка альбомов...</Text>
                </View>
                <TabBar/>
            </>
        );
    }

    if (albums.length === 0) {
        return (
            <>
                <View style={styles.emptyContainer}>
                    {/* Хедер даже для пустого состояния */}
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Ionicons name="arrow-back" size={24} color={theme.primary}/>
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Альбомы @{username}</Text>
                        {/* Кнопка создания альбома для владельца */}
                        {currentUser === username && (
                            <TouchableOpacity
                                style={styles.createButton}
                                onPress={() => setCreateModalVisible(true)}
                            >
                                <Ionicons name="add" size={24} color={theme.primary}/>
                            </TouchableOpacity>
                        )}
                    </View>

                    {/* Основное содержимое пустого состояния */}
                    <View style={styles.emptyContent}>
                        <Ionicons name="images-outline" size={64} color={theme.textSecondary}/>
                        <Text style={styles.emptyText}>
                            {currentUser === username
                                ? 'У вас пока нет альбомов'
                                : 'У пользователя нет альбомов'
                            }
                        </Text>

                        {/* Кнопки действий */}
                        <View style={styles.emptyActions}>
                            {currentUser === username && (
                                <TouchableOpacity
                                    style={styles.createFirstAlbumButton}
                                    onPress={() => setCreateModalVisible(true)}
                                >
                                    <Ionicons name="add-circle" size={20} color="white"/>
                                    <Text style={styles.createFirstAlbumButtonText}>Создать первый альбом</Text>
                                </TouchableOpacity>
                            )}

                            <TouchableOpacity style={styles.refreshButton} onPress={fetchAlbums}>
                                <Text style={styles.refreshButtonText}>Обновить</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Модальные окна */}
                    <AlbumCreateModal
                        visible={createModalVisible}
                        onClose={() => setCreateModalVisible(false)}
                        onAlbumCreated={() => {
                            fetchAlbums();
                        }}
                    />
                </View>
                <TabBar/>
            </>
        );
    }

    return (
        <>
            <View style={{flex: 1}}>
                <View style={styles.container}>
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Ionicons name="arrow-back" size={24} color={theme.primary}/>
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Альбомы @{username}</Text>
                        {currentUser === username && (
                            <TouchableOpacity
                                style={styles.createButton}
                                onPress={() => setCreateModalVisible(true)}
                            >
                                <Ionicons name="add" size={24} color={theme.primary}/>
                            </TouchableOpacity>
                        )}
                    </View>

                    <FlatList
                        data={albums}
                        renderItem={renderAlbum}
                        keyExtractor={(item) => item.id.toString()}
                        numColumns={2}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={onRefresh}
                                colors={[theme.primary]}
                                tintColor={theme.primary}
                            />
                        }
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[styles.listContainer, {paddingBottom: 100}]}
                        columnWrapperStyle={styles.row}
                    />

                    <AlbumCreateModal
                        visible={createModalVisible}
                        onClose={() => setCreateModalVisible(false)}
                        onAlbumCreated={() => {
                            fetchAlbums();
                        }}
                    />

                    <AlbumEditModal
                        visible={editModalVisible}
                        album={selectedAlbum}
                        onClose={() => {
                            setEditModalVisible(false);
                            setSelectedAlbum(null);
                        }}
                        onAlbumUpdated={handleAlbumUpdated}
                        onAlbumDeleted={handleAlbumDeleted}
                    />
                </View>

                <TabBar/>
            </View>
        </>
    );
}

const createStyles = (theme: any) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surface,
        paddingHorizontal: 16,
        paddingVertical: 12,
        paddingTop: 50,
        elevation: 4,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: theme.text,
        flex: 1,
    },
    createButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.primary + '15',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 16,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.background,
    },
    loadingText: {
        marginTop: 16,
        color: theme.textSecondary,
        fontSize: 16,
        fontWeight: '500',
    },
    emptyContainer: {
        flex: 1,
        backgroundColor: theme.background,
    },
    emptyContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    emptyText: {
        fontSize: 18,
        color: theme.textSecondary,
        marginTop: 24,
        marginBottom: 32,
        textAlign: 'center',
        lineHeight: 24,
    },
    emptyActions: {
        alignItems: 'center',
        gap: 16,
    },
    createFirstAlbumButton: {
        backgroundColor: theme.primary,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 28,
        paddingVertical: 16,
        borderRadius: 25,
        marginBottom: 12,
        elevation: 3,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.15,
        shadowRadius: 6,
    },
    createFirstAlbumButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 8,
    },
    refreshButton: {
        backgroundColor: theme.success || '#34C759',
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 12,
        elevation: 2,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    refreshButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    listContainer: {
        padding: 16,
    },
    row: {
        justifyContent: 'space-between',
    },
    albumItem: {
        width: albumWidth,
        backgroundColor: theme.surface,
        borderRadius: 16,
        marginBottom: 20,
        elevation: 4,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 8,
        overflow: 'hidden',
    },
    albumCover: {
        position: 'relative',
        height: albumWidth,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        overflow: 'hidden',
    },
    coverImage: {
        width: '100%',
        height: '100%',
    },
    emptyCover: {
        width: '100%',
        height: '100%',
        backgroundColor: theme.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    hiddenBadge: {
        position: 'absolute',
        top: 12,
        right: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 16,
        padding: 6,
        elevation: 2,
    },
    photoCount: {
        position: 'absolute',
        bottom: 12,
        right: 12,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 16,
        paddingHorizontal: 10,
        paddingVertical: 6,
        elevation: 2,
    },
    photoCountText: {
        color: 'white',
        fontSize: 12,
        fontWeight: 'bold',
    },
    albumInfo: {
        padding: 16,
    },
    albumTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: theme.text,
        marginBottom: 6,
        lineHeight: 20,
    },
    albumDate: {
        fontSize: 13,
        color: theme.textSecondary,
        fontWeight: '500',
    },
});