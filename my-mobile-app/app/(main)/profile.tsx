import React, {useState, useEffect} from 'react';
import {
    View,
    Text,
    StyleSheet,
    Image,
    TouchableOpacity,
    ScrollView,
    Alert,
    RefreshControl,
    Modal,
    Dimensions
} from 'react-native';
import {router} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
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

export default function Profile() {
    const {theme, themeType, toggleTheme} = useTheme();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [avatarModalVisible, setAvatarModalVisible] = useState(false);

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

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchProfile();
        setRefreshing(false);
    };

    useEffect(() => {
        fetchProfile();
    }, []);

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
                            router.replace('/login');
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
                    <View style={styles.avatarSection}>
                        <TouchableOpacity onPress={() => setAvatarModalVisible(true)} style={styles.avatarContainer}>
                            <Image
                                source={
                                    profile.avatar
                                        ? {uri: profile.avatar}
                                        : profile.gender === 'male'
                                            ? require('../../assets/avatar/male.png')
                                            : require('../../assets/avatar/female.png')
                                }
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

                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={handleViewAlbums}
                    >
                        <View style={styles.actionIconContainer}>
                            <Ionicons name="images-outline" size={20} color={theme.primary}/>
                        </View>
                        <Text style={styles.actionButtonText}>Мои альбомы</Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary}/>
                    </TouchableOpacity>


                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={toggleTheme}
                    >
                        <View style={styles.actionIconContainer}>
                            <Ionicons
                                name={themeType ? "sunny-outline" : "moon-outline"}
                                size={20}
                                color={theme.primary}
                            />
                        </View>
                        <Text style={styles.actionButtonText}>
                            {themeType ? "Светлая тема" : "Тёмная тема"}
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.textSecondary}/>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, styles.logoutButton]}
                        onPress={handleLogout}
                    >
                        <View style={[styles.actionIconContainer, styles.logoutIconContainer]}>
                            <Ionicons name="log-out-outline" size={20} color={theme.error}/>
                        </View>
                        <Text style={[styles.actionButtonText, styles.logoutText]}>
                            Выйти из аккаунта
                        </Text>
                        <Ionicons name="chevron-forward" size={16} color={theme.error}/>
                    </TouchableOpacity>
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
                                <Image
                                    source={
                                        profile.avatar
                                            ? {uri: profile.avatar}
                                            : profile.gender === 'male'
                                                ? require('../../assets/avatar/male.png')
                                                : require('../../assets/avatar/female.png')
                                    }
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
        paddingVertical: 40,
        paddingHorizontal: 20,
        borderBottomLeftRadius: 20,
        borderBottomRightRadius: 20,
        elevation: 3,
        shadowColor: theme.text,
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.1,
        shadowRadius: 6,
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