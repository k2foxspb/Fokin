import React, {useState, useEffect} from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    Alert,
    RefreshControl,
    Modal,
    Dimensions,
    FlatList
} from 'react-native';
import {router, useLocalSearchParams} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '../../contexts/ThemeContext';
import {API_CONFIG} from "../../config";
import TabBar from '../../components/TabBar';
import CachedImage from '../../components/CachedImage';

interface UserProfile {
    id: number;
    username: string;
    first_name: string;
    last_name: string;
    avatar?: string;
    bio?: string;
    gender?: string;
    birthday?: string;
    age?: number;
    is_online?: string;
}

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

export default function UserProfile() {
    const { theme } = useTheme();
    const { username } = useLocalSearchParams<{ username: string }>();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [avatarModalVisible, setAvatarModalVisible] = useState(false);
    const [isLoadingChat, setIsLoadingChat] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<number | null>(null);
    const [currentUsername, setCurrentUsername] = useState<string | null>(null);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [albumsLoading, setAlbumsLoading] = useState(false);

    const styles = createStyles(theme);

    const fetchCurrentUser = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) return;

            const response = await axios.get(`${API_CONFIG.BASE_URL}/profile/api/profile/me/`, {
                headers: {Authorization: `Token ${token}`}
            });

            setCurrentUserId(response.data.id);
            setCurrentUsername(response.data.username);
        } catch (error) {
            // Ошибка получения текущего пользователя
        }
    };

    const fetchProfile = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                router.replace('/(auth)/login');
                return;
            }

            const response = await axios.get(`${API_CONFIG.BASE_URL}/profile/api/profile/${username}/`, {
                headers: {Authorization: `Token ${token}`}
            });

            setProfile(response.data);
        } catch (error) {
            Alert.alert('Ошибка', 'Не удалось загрузить профиль пользователя');
            router.back();
        }
    };

    const fetchAlbums = async () => {
        if (!profile) return;

        setAlbumsLoading(true);
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) return;

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/photo/api/user/${profile.username}/albums/`,
                {
                    headers: {Authorization: `Token ${token}`}
                }
            );

            console.log('Albums data:', response.data);
            if (response.data && response.data.length > 0) {
                console.log('First album:', response.data[0]);
                console.log('First album cover_photo:', response.data[0].cover_photo);
            }

            setAlbums(response.data || []);
        } catch (error) {
            console.error('Не удалось загрузить альбомы:', error);
            setAlbums([]);
        } finally {
            setAlbumsLoading(false);
        }
    };

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchProfile();
        if (profile) {
            await fetchAlbums();
        }
        setRefreshing(false);
    };

    useEffect(() => {
        if (username) {
            fetchCurrentUser();
            fetchProfile();
        }
    }, [username]);

    useEffect(() => {
        if (profile) {
            fetchAlbums();
        }
    }, [profile]);

    const handleViewAlbums = () => {
        if (profile) {
            router.push(`/albums/${profile.username}`);
        }
    };

    // Исправленная функция для создания чата - используем логику из Selection
    const handleStartChat = async () => {
        if (!profile || !currentUsername) return;

        // Предотвращаем создание чата с самим собой
        if (profile.id === currentUserId) {
            Alert.alert('Уведомление', 'Вы не можете создать чат с самим собой');
            return;
        }

        setIsLoadingChat(true);
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                router.replace('/(auth)/login');
                return;
            }

            // Получаем или создаем room ID для разговора - используем правильный endpoint
            const roomResponse = await axios.get(
                `${API_CONFIG.BASE_URL}/chat/api/get_private_room/${currentUsername}/${username}/`,
                {
                    headers: { Authorization: `Token ${token}` }
                }
            );

            const roomId = roomResponse.data.room_name;

            // Переходим в чат с room ID
            router.push(`/chat/${roomId}`);
        } catch (error) {
            // Ошибка создания/получения чата
            Alert.alert('Ошибка', 'Не удалось открыть чат');
        } finally {
            setIsLoadingChat(false);
        }
    };

    const formatBirthday = (birthday?: string) => {
        if (!birthday) return 'Не указано';
        const date = new Date(birthday);
        return date.toLocaleDateString('ru-RU');
    };

    // Если профиль не загружен, показываем загрузку БЕЗ TabBar
    if (!profile) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Загрузка...</Text>
            </View>
        );
    }

    // Когда профиль загружен, показываем контент С TabBar
    return (
        <>
            <View style={styles.container}>
                <ScrollView
                    style={styles.scrollView}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={onRefresh}
                            colors={[theme.primary]}
                            tintColor={theme.primary}
                        />
                    }
                    showsVerticalScrollIndicator={false}
                >
                    {/* Header Section */}
                    <View style={styles.header}>
                        <TouchableOpacity
                            style={styles.backButton}
                            onPress={() => router.back()}
                        >
                            <Ionicons name="arrow-back" size={24} color={theme.primary} />
                        </TouchableOpacity>

                        <View style={styles.avatarSection}>
                            <TouchableOpacity onPress={() => setAvatarModalVisible(true)} style={styles.avatarContainer}>
                                <CachedImage
                                    uri={profile.avatar || ''}

                                    style={styles.avatar}
                                />

                                {/* Индикатор онлайн статуса */}
                                <View style={[
                                    styles.onlineIndicator,
                                    {backgroundColor: profile.is_online === 'online' ? theme.online : theme.offline}
                                ]} />
                            </TouchableOpacity>

                            <View style={styles.userInfo}>
                                <Text style={styles.name}>
                                    {profile.first_name} {profile.last_name}
                                </Text>
                                <Text style={styles.username}>@{profile.username}</Text>
                                <Text style={[
                                    styles.onlineStatus,
                                    {color: profile.is_online === 'online' ? theme.online : theme.offline}
                                ]}>
                                    {profile.is_online === 'online' ? 'в сети' : 'не в сети'}
                                </Text>
                            </View>
                        </View>
                    </View>

                    {/* Bio Section */}
                    {profile.bio && (
                        <View style={styles.bioSection}>
                            <Text style={styles.bioText}>{profile.bio}</Text>
                        </View>
                    )}

                    {/* Info Section */}
                    <View style={styles.infoSection}>
                        <Text style={styles.sectionTitle}>Информация</Text>

                        <View style={styles.infoCard}>
                            {profile.gender && (
                                <View style={styles.infoRow}>
                                    <View style={styles.infoIconContainer}>
                                        <Ionicons name="person-outline" size={20} color={theme.primary} />
                                    </View>
                                    <View style={styles.infoContent}>
                                        <Text style={styles.infoLabel}>Пол</Text>
                                        <Text style={styles.infoText}>
                                            {profile.gender === 'male' ? 'Мужчина' : 'Женщина'}
                                        </Text>
                                    </View>
                                </View>
                            )}

                            {profile.birthday && (
                                <>
                                    {profile.gender && <View style={styles.divider} />}
                                    <View style={styles.infoRow}>
                                        <View style={styles.infoIconContainer}>
                                            <Ionicons name="calendar-outline" size={20} color={theme.primary} />
                                        </View>
                                        <View style={styles.infoContent}>
                                            <Text style={styles.infoLabel}>Дата рождения</Text>
                                            <Text style={styles.infoText}>
                                                {formatBirthday(profile.birthday)}
                                                {profile.age && ` (${profile.age} лет)`}
                                            </Text>
                                        </View>
                                    </View>
                                </>
                            )}

                            {/* Показываем сообщение, если нет дополнительной информации */}
                            {!profile.gender && !profile.birthday && (
                                <View style={styles.infoRow}>
                                    <View style={styles.infoIconContainer}>
                                        <Ionicons name="information-circle-outline" size={20} color={theme.textSecondary} />
                                    </View>
                                    <View style={styles.infoContent}>
                                        <Text style={[styles.infoText, { color: theme.textSecondary, fontStyle: 'italic' }]}>
                                            Дополнительная информация не указана
                                        </Text>
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>

                    {/* Actions Section */}
                    <View style={styles.actionsSection}>
                        <TouchableOpacity
                            style={styles.actionButton}
                            onPress={handleStartChat}
                            disabled={isLoadingChat || profile.id === currentUserId}
                        >
                            <View style={[
                                styles.actionIconContainer,
                                profile.id === currentUserId && styles.disabledIconContainer
                            ]}>
                                {isLoadingChat ? (
                                    <View style={styles.loadingIcon} />
                                ) : (
                                    <Ionicons
                                        name="chatbubble-outline"
                                        size={20}
                                        color={profile.id === currentUserId ? theme.textSecondary : theme.primary}
                                    />
                                )}
                            </View>
                            <Text style={[
                                styles.actionButtonText,
                                profile.id === currentUserId && styles.disabledText
                            ]}>
                                {profile.id === currentUserId ? 'Это ваш профиль' : 'Написать сообщение'}
                            </Text>
                            {profile.id !== currentUserId && (
                                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                            )}
                        </TouchableOpacity>


                    </View>
                    <View style={styles.albumsSection}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>Альбомы</Text>
                            <TouchableOpacity
                                onPress={handleViewAlbums}
                                style={styles.viewAllButton}
                            >
                                <Text style={styles.viewAllText}>Все альбомы</Text>
                                <Ionicons name="chevron-forward" size={16} color={theme.primary}/>
                            </TouchableOpacity>
                        </View>

                        {albumsLoading ? (
                            <View style={styles.albumsLoading}>
                                <Text style={styles.loadingText}>Загрузка альбомов...</Text>
                            </View>
                        ) : albums.length > 0 ? (
                            <FlatList
                                data={albums.slice(0, 6)} // Показываем максимум 6 альбомов
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                keyExtractor={(item) => item.id.toString()}
                                contentContainerStyle={styles.albumsList}
                                renderItem={({ item }) => (
                                    <TouchableOpacity
                                        style={styles.albumCard}
                                        onPress={() => router.push(`/album/${item.id}`)}
                                    >
                                        <View style={styles.albumImageContainer}>
                                            {item.cover_photo ? (
                                                <CachedImage
                                                    uri={item.cover_photo.thumbnail_url || item.cover_photo.image_url}
                                                    style={styles.albumImage}
                                                    resizeMode="cover"
                                                />
                                            ) : (
                                                <View style={styles.albumPlaceholder}>
                                                    <Ionicons name="images-outline" size={32} color={theme.textSecondary}/>
                                                </View>
                                            )}
                                        </View>
                                        <View style={styles.albumInfo}>
                                            <Text style={styles.albumName} numberOfLines={2}>
                                                {item.title}
                                            </Text>
                                            <Text style={styles.albumCount}>
                                                {item.photos_count} фото
                                            </Text>
                                        </View>
                                    </TouchableOpacity>
                                )}
                            />
                        ) : (
                            <View style={styles.emptyAlbums}>
                                <Ionicons name="images-outline" size={48} color={theme.textSecondary}/>
                                <Text style={styles.emptyAlbumsText}>Пока нет альбомов</Text>
                            </View>
                        )}
                    </View>

                    {/* Отступ для нижней навигации */}
                    <View style={styles.bottomSpacer} />
                </ScrollView>
            </View>

            {/* Нижняя навигационная панель - показывается ТОЛЬКО когда профиль загружен */}
            <TabBar />

            {/* Avatar Modal */}
            <Modal
                visible={avatarModalVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setAvatarModalVisible(false)}
                statusBarTranslucent={true}
            >
                <View style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity
                            style={styles.modalButton}
                            onPress={() => setAvatarModalVisible(false)}
                            activeOpacity={0.7}
                        >
                            <Ionicons name="close" size={24} color="white" />
                            <Text style={styles.buttonText}>Закрыть</Text>
                        </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                        style={styles.modalBackground}
                        onPress={() => setAvatarModalVisible(false)}
                        activeOpacity={1}
                    >
                        <View style={styles.modalContent}>
                            <View style={styles.imageContainer}>
                                <CachedImage
                                    uri={profile.avatar || ''}

                                    style={styles.fullImage}
                                    resizeMode="contain"
                                />
                            </View>
                        </View>
                    </TouchableOpacity>
                </View>
            </Modal>
        </>
    );
}

const createStyles = (theme: any) => StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: theme.background,
    },
    scrollView: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: theme.background,
    },
    loadingText: {
        color: theme.textSecondary,
        fontSize: 16,
    },
    header: {
        backgroundColor: theme.surface,
        paddingVertical: 40,
        paddingHorizontal: 20,
        paddingTop: 60,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        elevation: 3,
        shadowColor: theme.text,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 6,
    },
    backButton: {
        position: 'absolute',
        top: 60,
        left: 20,
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: theme.background + '20',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1,
    },
    avatarSection: {
        alignItems: 'center',
        marginTop: 20,
    },
    avatarContainer: {
        position: 'relative',
        marginBottom: 16,
    },
    avatar: {
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 4,
        borderColor: theme.border,
    },
    onlineIndicator: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 3,
        borderColor: theme.surface,
        elevation: 2,
        shadowColor: theme.text,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
    },
    userInfo: {
        alignItems: 'center',
    },
    name: {
        fontSize: 24,
        fontWeight: 'bold',
        color: theme.text,
        marginBottom: 4,
    },
    username: {
        fontSize: 16,
        color: theme.textSecondary,
        marginBottom: 6,
    },
    onlineStatus: {
        fontSize: 14,
        fontWeight: '500',
    },
    bioSection: {
        backgroundColor: theme.surface,
        margin: 16,
        padding: 16,
        borderRadius: 12,
        elevation: 2,
        shadowColor: theme.text,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
    },
    bioText: {
        fontSize: 16,
        color: theme.text,
        lineHeight: 22,
        textAlign: 'center',
        fontStyle: 'italic',
    },
    infoSection: {
        marginHorizontal: 16,
        marginBottom: 16,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: theme.text,
        marginBottom: 12,
        marginLeft: 4,
    },
    infoCard: {
        backgroundColor: theme.surface,
        borderRadius: 12,
        elevation: 2,
        shadowColor: theme.text,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    infoIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: theme.primary + '20',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    infoContent: {
        flex: 1,
    },
    infoLabel: {
        fontSize: 12,
        color: theme.textSecondary,
        marginBottom: 2,
        fontWeight: '500',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    infoText: {
        fontSize: 16,
        color: theme.text,
        fontWeight: '500',
    },
    divider: {
        height: 1,
        backgroundColor: theme.border,
        marginHorizontal: 16,
    },
    actionsSection: {
        marginHorizontal: 16,
        marginBottom: 16,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surface,
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: 12,
        marginBottom: 8,
        elevation: 2,
        shadowColor: theme.text,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
    },
    actionIconContainer: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: theme.primary + '20',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    disabledIconContainer: {
        backgroundColor: theme.textSecondary + '20',
    },
    actionButtonText: {
        flex: 1,
        fontSize: 16,
        color: theme.text,
        fontWeight: '500',
    },
    disabledText: {
        color: theme.textSecondary,
    },
    loadingIcon: {
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.primary + '40',
    },
    bottomSpacer: {
        height: 100, // Отступ для нижней навигации
    },
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingTop: 50,
        paddingHorizontal: 20,
        paddingBottom: 10,
    },
    modalButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
    },
    buttonText: {
        color: 'white',
        marginLeft: 8,
        fontSize: 16,
        fontWeight: '500',
    },
    modalBackground: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageContainer: {
        width: Dimensions.get('window').width,
        height: Dimensions.get('window').width,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullImage: {
        width: '100%',
        height: '100%',
    },
    albumsSection: {
        marginHorizontal: 16,
        marginBottom: 16,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    viewAllButton: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    viewAllText: {
        fontSize: 14,
        color: theme.primary,
        fontWeight: '500',
        marginRight: 4,
    },
    albumsList: {
        paddingHorizontal: 4,
    },
    albumCard: {
        width: 150,
        marginRight: 12,
        backgroundColor: theme.surface,
        borderRadius: 12,
        elevation: 2,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 3,
        overflow: 'hidden',
    },
    albumImageContainer: {
        width: '100%',
        height: 150,
        position: 'relative',
    },
    albumImage: {
        width: '100%',
        height: '100%',
    },
    albumPlaceholder: {
        width: '100%',
        height: '100%',
        backgroundColor: theme.border,
        justifyContent: 'center',
        alignItems: 'center',
    },
    albumInfo: {
        padding: 12,
    },
    albumName: {
        fontSize: 14,
        fontWeight: '600',
        color: theme.text,
        marginBottom: 4,
        lineHeight: 18,
    },
    albumCount: {
        fontSize: 12,
        color: theme.textSecondary,
    },
    albumsLoading: {
        padding: 40,
        alignItems: 'center',
    },
    emptyAlbums: {
        padding: 40,
        alignItems: 'center',
        backgroundColor: theme.surface,
        borderRadius: 12,
        elevation: 1,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.05,
        shadowRadius: 2,
    },
    emptyAlbumsText: {
        fontSize: 16,
        color: theme.textSecondary,
        marginTop: 8,
    },
});