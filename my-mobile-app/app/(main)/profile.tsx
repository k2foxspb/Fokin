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
import {router} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
import CachedImage from '../../components/CachedImage';
import ProfileEditModal from '../../components/ProfileEditModal';
import {useTheme} from '../../contexts/ThemeContext';
import {API_CONFIG} from "../../config";

interface UserProfile {
    id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    avatar?: string;
    bio?: string;
    gender: string;
    birthday?: string;
    age?: number;
}

interface Album {
    id: number;
    title: string;
    description?: string;
    created_at: string;
    photos_count: number;
    cover_photo: Photo | null;
    hidden_flag?: boolean;
}

interface Photo {
    id: number;
    image: string;
    title?: string;
    uploaded_at: string;
}

export default function Profile() {
    const {theme, themeType, toggleTheme} = useTheme();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [avatarModalVisible, setAvatarModalVisible] = useState(false);
    const [albums, setAlbums] = useState<Album[]>([]);
    const [albumsLoading, setAlbumsLoading] = useState(false);

    const styles = createStyles(theme);

    const fetchProfile = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                router.replace('/(auth)/login');
                return;
            }

            const response = await axios.get(`${API_CONFIG.BASE_URL}/profile/api/profile/me/`, {
                headers: {Authorization: `Token ${token}`}
            });

            setProfile(response.data);
        } catch (error) {
            Alert.alert('Ошибка', 'Не удалось загрузить данные профиля');
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

            console.log('Profile albums data:', response.data);
            if (response.data && response.data.length > 0) {
                console.log('First profile album:', response.data[0]);
                console.log('First profile album cover_photo:', response.data[0].cover_photo);
            }

            // Обрабатываем данные альбомов согласно структуре из albums API
            const albumsData = (response.data || []).map((album: any) => ({
                id: album.id,
                title: album.title || 'Без названия',
                description: album.description,
                created_at: album.created_at,
                photos_count: album.photos_count || 0,
                cover_photo: album.cover_photo || null,
                hidden_flag: album.hidden_flag || false
            }));

            setAlbums(albumsData);
        } catch (error) {
            console.error('Не удалось загрузить альбомы:', error);
            // Просто оставляем пустой список альбомов при ошибке
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
        fetchProfile();
    }, []);

    useEffect(() => {
        if (profile) {
            fetchAlbums();
        }
    }, [profile]);

    const handleLogout = async () => {
        Alert.alert(
            'Выход',
            'Вы уверены, что хотите выйти из аккаунта?',
            [
                {
                    text: 'Отмена',
                    style: 'cancel'
                },
                {
                    text: 'Выйти',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await AsyncStorage.removeItem('userToken');
                            delete axios.defaults.headers.common['Authorization'];
                            router.replace('/(auth)/login');
                        } catch (error) {
                            Alert.alert('Ошибка', 'Не удалось выйти из системы');
                        }
                    }
                }
            ]
        );
    };

    const handleViewAlbums = () => {
        if (profile) {
            // Переход к списку альбомов пользователя
            router.push(`/albums/${profile.username}`);
        }
    };

    const handleViewChats = () => {
        router.push('/(main)/chats');
    };

    const formatBirthday = (birthday?: string) => {
        if (!birthday) return 'Не указано';
        const date = new Date(birthday);
        return date.toLocaleDateString('ru-RU');
    };

    if (!profile) {
        return (
            <View style={styles.loadingContainer}>
                <Text style={styles.loadingText}>Загрузка...</Text>
            </View>
        );
    }

    return (
        <>
            <ScrollView
                style={styles.container}
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
                    {/* Top Controls */}
                    <View style={styles.topControls}>
                        <TouchableOpacity
                            style={styles.topButton}
                            onPress={toggleTheme}
                        >
                            <Ionicons
                                name={themeType ? "sunny" : "moon"}
                                size={24}
                                color={theme.primary}
                            />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.topButton, styles.logoutTopButton]}
                            onPress={handleLogout}
                        >
                            <Ionicons name="log-out" size={24} color={theme.error}/>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.avatarSection}>
                        <TouchableOpacity onPress={() => setAvatarModalVisible(true)} style={styles.avatarContainer}>
                            <CachedImage
                                uri={profile.avatar || ''}
                                style={styles.avatar}
                            />
                            <View style={styles.editAvatarOverlay}>
                                <Ionicons name="camera" size={20} color="white"/>
                            </View>
                        </TouchableOpacity>

                        <View style={styles.userInfo}>
                            <Text style={styles.name}>
                                {profile.first_name} {profile.last_name}
                            </Text>
                            <Text style={styles.username}>@{profile.username}</Text>
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
                    <Text style={styles.sectionTitle}>Личная информация</Text>

                    <View style={styles.infoCard}>
                        <View style={styles.infoRow}>
                            <View style={styles.infoIconContainer}>
                                <Ionicons name="mail-outline" size={20} color={theme.primary}/>
                            </View>
                            <View style={styles.infoContent}>
                                <Text style={styles.infoLabel}>Email</Text>
                                <Text style={styles.infoText}>{profile.email}</Text>
                            </View>
                        </View>

                        {profile.gender && (
                            <>
                                <View style={styles.divider}/>
                                <View style={styles.infoRow}>
                                    <View style={styles.infoIconContainer}>
                                        <Ionicons name="person-outline" size={20} color={theme.primary}/>
                                    </View>
                                    <View style={styles.infoContent}>
                                        <Text style={styles.infoLabel}>Пол</Text>
                                        <Text style={styles.infoText}>
                                            {profile.gender === 'male' ? 'Мужчина' : 'Женщина'}
                                        </Text>
                                    </View>
                                </View>
                            </>
                        )}

                        {profile.birthday && (
                            <>
                                <View style={styles.divider}/>
                                <View style={styles.infoRow}>
                                    <View style={styles.infoIconContainer}>
                                        <Ionicons name="calendar-outline" size={20} color={theme.primary}/>
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
                    </View>
                </View>

                {/* Actions Section */}
                <View style={styles.actionsSection}>
                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => setEditModalVisible(true)}
                    >
                        <View style={styles.actionIconContainer}>
                            <Ionicons name="create-outline" size={20} color={theme.primary}/>
                        </View>
                        <Text style={styles.actionButtonText}>Редактировать профиль</Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary}/>
                    </TouchableOpacity>
                </View>

                {/* Albums Section */}
                <View style={styles.albumsSection}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Мои альбомы</Text>
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
                            data={albums}
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
                            <TouchableOpacity
                                style={styles.createAlbumButton}
                                onPress={() => router.push(`/albums/${profile.username}`)}
                            >
                                <Text style={styles.createAlbumText}>Создать альбом</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>

                <View style={styles.bottomSpacer}/>
            </ScrollView>

            <ProfileEditModal
                visible={editModalVisible}
                profile={profile}
                onClose={() => setEditModalVisible(false)}
                onProfileUpdated={() => {
                    fetchProfile();
                    setEditModalVisible(false);
                }}
            />

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
                            <Ionicons name="close" size={24} color="white"/>
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
        paddingVertical: 20,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        elevation: 3,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 6,
    },
    topControls: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        paddingTop: 20,
    },
    topButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: theme.primary + '20',
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoutTopButton: {
        backgroundColor: theme.error + '20',
    },
    avatarSection: {
        alignItems: 'center',
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
    editAvatarOverlay: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: theme.primary,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 3,
        borderColor: theme.surface,
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
    },
    bioSection: {
        backgroundColor: theme.surface,
        margin: 16,
        padding: 16,
        borderRadius: 12,
        elevation: 2,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 1},
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
        shadowOffset: {width: 0, height: 1},
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
        shadowOffset: {width: 0, height: 1},
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
    actionButtonText: {
        flex: 1,
        fontSize: 16,
        color: theme.text,
        fontWeight: '500',
    },
    logoutButton: {
        marginTop: 8,
    },
    logoutIconContainer: {
        backgroundColor: theme.error + '20',
    },
    logoutText: {
        color: theme.error,
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
        marginBottom: 12,
    },
    createAlbumButton: {
        backgroundColor: theme.primary,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 16,
    },
    createAlbumText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '600',
    },
    bottomSpacer: {
        height: 100,
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
});