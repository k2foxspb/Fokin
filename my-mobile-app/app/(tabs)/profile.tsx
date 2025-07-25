import React, {useState, useEffect} from 'react';
import {
    View,
    Text,
    StyleSheet,
    Image,
    TouchableOpacity,
    ScrollView,
    Alert,
    RefreshControl
} from 'react-native';
import {router} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
import ProfileEditModal from '../../components/ProfileEditModal';
import {API_CONFIG} from "@/app/config";

interface UserProfile {
    id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    avatar?: string;
    bio?: string;
}

export default function Profile() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);

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
            console.log(response.data)
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
        try {
            await AsyncStorage.removeItem('userToken');
            delete axios.defaults.headers.common['Authorization'];
            router.replace('/login');
        } catch (error) {
            Alert.alert('Ошибка', 'Не удалось выйти из системы');
        }
    };

    const handleViewAlbums = () => {
        if (profile) {
            router.push(`/albums/${profile.username}`);
        }
    };

    if (!profile) {
        return (
            <View style={styles.loadingContainer}>
                <Text>Загрузка...</Text>
            </View>
        );
    }

    return (
        <>
            <ScrollView
                style={styles.container}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh}/>
                }
            >
                <View style={styles.header}>
                    <Image
                        source={
                            profile.avatar
                                ? {uri: profile.avatar}
                                : require('../../assets/avatar/male.png')
                        }
                        style={styles.avatar}
                    />
                    <Text style={styles.name}>
                        {profile.first_name} {profile.last_name}
                    </Text>
                    <Text style={styles.username}>@{profile.username}</Text>
                </View>

                <View style={styles.infoSection}>
                    <View style={styles.infoRow}>
                        <Ionicons name="mail-outline" size={20} color="#666"/>
                        <Text style={styles.infoText}>{profile.email}</Text>
                    </View>
                    {profile.bio && (
                        <View style={styles.infoRow}>
                            <Ionicons name="information-circle-outline" size={20} color="#666"/>
                            <Text style={styles.infoText}>{profile.bio}</Text>
                        </View>
                    )}
                </View>

                <View style={styles.actionsSection}>
                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={() => setEditModalVisible(true)}
                    >
                        <Ionicons name="create-outline" size={20} color="#007AFF"/>
                        <Text style={styles.actionButtonText}>Редактировать профиль</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.actionButton}
                        onPress={handleViewAlbums}
                    >
                        <Ionicons name="images-outline" size={20} color="#007AFF"/>
                        <Text style={styles.actionButtonText}>Мои альбомы</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.actionButton, styles.logoutButton]}
                        onPress={handleLogout}
                    >
                        <Ionicons name="log-out-outline" size={20} color="#FF3B30"/>
                        <Text style={[styles.actionButtonText, styles.logoutText]}>
                            Выйти из аккаунта
                        </Text>
                    </TouchableOpacity>
                </View>
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
        </>
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
    header: {
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#e1e1e1',
    },
    avatar: {
        width: 100,
        height: 100,
        borderRadius: 50,
        marginBottom: 10,
    },
    name: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#000',
    },
    username: {
        fontSize: 16,
        color: '#666',
        marginTop: 5,
    },
    infoSection: {
        backgroundColor: '#fff',
        padding: 15,
        marginTop: 10,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
    },
    infoText: {
        marginLeft: 10,
        fontSize: 16,
        color: '#333',
    },
    actionsSection: {
        backgroundColor: '#fff',
        marginTop: 10,
        padding: 15,
    },
    actionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e1e1e1',
    },
    actionButtonText: {
        marginLeft: 10,
        fontSize: 16,
        color: '#007AFF',
    },
    logoutButton: {
        borderBottomWidth: 0,
        marginTop: 10,
    },
    logoutText: {
        color: '#FF3B30',
    },
});
