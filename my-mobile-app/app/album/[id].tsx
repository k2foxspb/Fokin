import React, {useState, useEffect, useCallback} from 'react';
import TabBar from '../../components/TabBar';
import { useTheme } from '../../contexts/ThemeContext';

import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    Image,
    ActivityIndicator,
    RefreshControl,
    Alert,
    Dimensions,
    Modal
} from 'react-native';
import {router, useLocalSearchParams} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
import {GestureDetector, Gesture} from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS
} from 'react-native-reanimated';
import PhotoUploadModal from '../../components/PhotoUploadModal';
import AlbumEditModal from '../../components/AlbumEditModal';
import {API_CONFIG} from '../../config';

const {width, height} = Dimensions.get('window');
const photoSize = (width - 48) / 3;

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
    photos: Photo[];
    photos_count: number;
    user?: {
        username: string;
    };
}

export default function AlbumDetail() {
    const { theme } = useTheme();
    const {id} = useLocalSearchParams<{ id: string }>();
    const [album, setAlbum] = useState<Album | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null);
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState<number>(0);
    const [modalVisible, setModalVisible] = useState(false);
    const [currentUser, setCurrentUser] = useState<string | null>(null);
    const [uploadModalVisible, setUploadModalVisible] = useState(false);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [deletingPhoto, setDeletingPhoto] = useState(false);
    const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
    const [buttonsVisible, setButtonsVisible] = useState(true);

    const styles = createStyles(theme);

    // Анимационные значения для масштабирования
    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const lastScale = useSharedValue(1);
    const lastTranslateX = useSharedValue(0);
    const lastTranslateY = useSharedValue(0);

    const [zoomLevel, setZoomLevel] = useState(0);

    // Кастомное модальное окно подтверждения удаления
    const DeleteConfirmModal = ({
                                    visible,
                                    onCancel,
                                    onConfirm,
                                    loading
                                }: {
        visible: boolean;
        onCancel: () => void;
        onConfirm: () => void;
        loading: boolean;
    }) => (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onCancel}
        >
            <View style={styles.deleteModalContainer}>
                <View style={styles.deleteModalContent}>
                    <Ionicons name="warning" size={48} color={theme.error} style={styles.deleteModalIcon}/>
                    <Text style={styles.deleteModalTitle}>Удалить фотографию?</Text>
                    <Text style={styles.deleteModalMessage}>Это действие нельзя отменить</Text>

                    <View style={styles.deleteModalButtons}>
                        <TouchableOpacity
                            style={[styles.deleteModalButton, styles.cancelButton]}
                            onPress={onCancel}
                            disabled={loading}
                        >
                            <Text style={styles.cancelButtonText}>Отмена</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.deleteModalButton, styles.confirmButton]}
                            onPress={onConfirm}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator size="small" color="white"/>
                            ) : (
                                <Text style={styles.confirmButtonText}>Удалить</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );

    // Функции навигации по фотографиям
    const goToNextPhoto = useCallback(() => {
        if (!album || album.photos.length === 0) return;
        const nextIndex = (currentPhotoIndex + 1) % album.photos.length;
        setCurrentPhotoIndex(nextIndex);
        setSelectedPhoto(album.photos[nextIndex]);
    }, [album, currentPhotoIndex]);

    const goToPreviousPhoto = useCallback(() => {
        if (!album || album.photos.length === 0) return;
        const prevIndex = (currentPhotoIndex - 1 + album.photos.length) % album.photos.length;
        setCurrentPhotoIndex(prevIndex);
        setSelectedPhoto(album.photos[prevIndex]);
    }, [album, currentPhotoIndex]);

    const resetZoom = useCallback(() => {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        lastScale.value = 1;
        lastTranslateX.value = 0;
        lastTranslateY.value = 0;
        setZoomLevel(0);
    }, [scale, translateX, translateY, lastScale, lastTranslateX, lastTranslateY]);

    const setZoom = useCallback((level: number) => {
        let targetScale = 1;
        switch (level) {
            case 1: targetScale = 2; break;
            case 2: targetScale = 3; break;
            default: targetScale = 1;
        }

        scale.value = withSpring(targetScale);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        lastScale.value = targetScale;
        lastTranslateX.value = 0;
        lastTranslateY.value = 0;
        setZoomLevel(level);
    }, [scale, translateX, translateY, lastScale, lastTranslateX, lastTranslateY]);

    const toggleButtonsVisibility = useCallback(() => {
        setButtonsVisible(prev => !prev);
    }, []);

    const handleDoubleTap = useCallback(() => {
        const nextLevel = (zoomLevel + 1) % 3;
        setZoom(nextLevel);
    }, [zoomLevel, setZoom]);

    // Жесты
    const doubleTapGesture = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => runOnJS(handleDoubleTap)());

    const singleTapGesture = Gesture.Tap()
        .numberOfTaps(1)
        .onEnd(() => runOnJS(toggleButtonsVisibility)());

    const pinchGesture = Gesture.Pinch()
        .onUpdate((event) => {
            scale.value = Math.max(0.5, Math.min(event.scale * lastScale.value, 5));
        })
        .onEnd(() => {
            lastScale.value = scale.value;
            if (scale.value <= 1.2) {
                runOnJS(setZoomLevel)(0);
            } else if (scale.value <= 2.5) {
                runOnJS(setZoomLevel)(1);
            } else {
                runOnJS(setZoomLevel)(2);
            }
        });

    const panGesture = Gesture.Pan()
        .onUpdate((event) => {
            if (scale.value > 1) {
                translateX.value = event.translationX + lastTranslateX.value;
                translateY.value = event.translationY + lastTranslateY.value;
            }
        })
        .onEnd((event) => {
            lastTranslateX.value = translateX.value;
            lastTranslateY.value = translateY.value;

            if (scale.value <= 1.2) {
                if (event.translationX < -50) {
                    runOnJS(goToNextPhoto)();
                } else if (event.translationX > 50) {
                    runOnJS(goToPreviousPhoto)();
                }
            }
        });

    const combinedGesture = Gesture.Simultaneous(
        Gesture.Exclusive(doubleTapGesture, singleTapGesture),
        pinchGesture,
        panGesture
    );

    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {scale: scale.value},
                {translateX: translateX.value},
                {translateY: translateY.value},
            ],
        };
    });

    const getCurrentUser = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) return;

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/profile/api/current-user/`,
                { headers: { Authorization: `Token ${token}` } }
            );
            setCurrentUser(response.data.username);
        } catch (error) {
            console.log('Error fetching current user:', error);
        }
    };

    const fetchAlbum = async () => {
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                router.replace('/(auth)/login');
                return;
            }

            const response = await axios.get(
                `${API_CONFIG.BASE_URL}/photo/api/album/${id}/`,
                { headers: { Authorization: `Token ${token}` } }
            );

            const filteredPhotos = response.data.photos.filter((photo: Photo) =>
                photo.image_url && photo.thumbnail_url
            );

            setAlbum({ ...response.data, photos: filteredPhotos });
        } catch (error) {
            console.error('Error fetching album:', error);
            Alert.alert('Ошибка', 'Не удалось загрузить альбом');
            router.back();
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const deletePhoto = async () => {
        if (!selectedPhoto) return;

        setDeletingPhoto(true);
        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                Alert.alert('Ошибка', 'Необходимо войти в систему');
                return;
            }

            await axios.delete(
                `${API_CONFIG.BASE_URL}/photo/api/photo/${selectedPhoto.id}/`,
                {
                    headers: {
                        Authorization: `Token ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                }
            );

            Alert.alert('Успех', 'Фотография удалена');
            setDeleteConfirmVisible(false);
            closeModal();
            await fetchAlbum();

        } catch (error: any) {
            console.error('Error deleting photo:', error);
            let errorMessage = 'Не удалось удалить фотографию';

            if (error.response) {
                switch (error.response.status) {
                    case 403: errorMessage = 'У вас нет прав для удаления этой фотографии'; break;
                    case 404: errorMessage = 'Фотография не найдена'; await fetchAlbum(); break;
                    case 500: errorMessage = 'Внутренняя ошибка сервера'; break;
                    default: errorMessage = `Ошибка сервера (${error.response.status})`;
                }
            } else if (error.request) {
                errorMessage = 'Сервер не отвечает. Проверьте подключение к интернету';
            }

            Alert.alert('Ошибка', errorMessage);
        } finally {
            setDeletingPhoto(false);
        }
    };

    const handleDeletePress = () => setDeleteConfirmVisible(true);
    const handleDeleteConfirm = () => deletePhoto();
    const handleDeleteCancel = () => setDeleteConfirmVisible(false);

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchAlbum();
    };

    useEffect(() => {
        if (id) {
            getCurrentUser();
            fetchAlbum();
        }
    }, [id]);

    useEffect(() => {
        resetZoom();
        setButtonsVisible(true);
    }, [selectedPhoto, resetZoom]);

    const handlePhotoPress = (photo: Photo, index: number) => {
        setSelectedPhoto(photo);
        setCurrentPhotoIndex(index);
        setModalVisible(true);
    };

    const closeModal = () => {
        setModalVisible(false);
        setSelectedPhoto(null);
        setDeleteConfirmVisible(false);
        resetZoom();
        setButtonsVisible(true);
    };

    const handleAlbumUpdated = () => fetchAlbum();
    const handleAlbumDeleted = () => router.back();

    const isOwner = currentUser && album && (
        currentUser === album.user?.username ||
        currentUser === (album as any).owner?.username ||
        currentUser === (album as any).creator?.username
    );

    const renderPhoto = ({item, index}: { item: Photo; index: number }) => (
        <TouchableOpacity
            style={styles.photoItem}
            onPress={() => handlePhotoPress(item, index)}
            activeOpacity={0.8}
        >
            <Image
                source={{uri: item.thumbnail_url}}
                style={styles.photoImage}
                resizeMode="cover"
            />
        </TouchableOpacity>
    );

    const albumId = id ? parseInt(id.toString(), 10) : undefined;

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary}/>
                <Text style={styles.loadingText}>Загрузка альбома...</Text>
                <TabBar/>
            </View>
        );
    }

    if (!album || !albumId) {
        return (
            <View style={styles.emptyContainer}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={theme.primary}/>
                </TouchableOpacity>
                <Ionicons name="alert-circle-outline" size={64} color={theme.textSecondary}/>
                <Text style={styles.emptyText}>Альбом не найден</Text>
                <TabBar/>
            </View>
        );
    }

    return (
        <View style={{flex: 1}}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={24} color={theme.primary}/>
                    </TouchableOpacity>
                    <View style={styles.headerInfo}>
                        <Text style={styles.headerTitle}>{album.title}</Text>
                        <Text style={styles.headerSubtitle}>
                            {album.photos.length} {album.photos.length === 1 ? 'фото' : 'фотографий'}
                            {album.hidden_flag && ' • Скрытый'}
                        </Text>
                    </View>

                    <View style={styles.headerButtons}>
                        {isOwner && (
                            <>
                                <TouchableOpacity
                                    style={styles.headerButton}
                                    onPress={() => setEditModalVisible(true)}
                                >
                                    <Ionicons name="create-outline" size={24} color={theme.primary}/>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={styles.headerButton}
                                    onPress={() => setUploadModalVisible(true)}
                                >
                                    <Ionicons name="camera" size={24} color={theme.primary}/>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                </View>

                {album.photos.length === 0 ? (
                    <View style={styles.emptyPhotosContainer}>
                        <Ionicons name="images-outline" size={64} color={theme.textSecondary}/>
                        <Text style={styles.emptyText}>В альбоме пока нет фотографий</Text>
                        {isOwner && (
                            <>
                                <TouchableOpacity
                                    style={styles.uploadFirstButton}
                                    onPress={() => setUploadModalVisible(true)}
                                >
                                    <Text style={styles.uploadFirstButtonText}>Загрузить первое фото</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.refreshButton} onPress={fetchAlbum}>
                                    <Text style={styles.refreshButtonText}>Обновить</Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </View>
                ) : (
                    <FlatList
                        data={album.photos}
                        renderItem={renderPhoto}
                        keyExtractor={(item) => item.id.toString()}
                        numColumns={3}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={onRefresh}
                                colors={[theme.primary]}
                                tintColor={theme.primary}
                            />
                        }
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[styles.photoList, {paddingBottom: 100}]}
                    />
                )}

                {/* Photo Modal */}
                <Modal
                    visible={modalVisible}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={closeModal}
                    statusBarTranslucent={true}
                >
                    <View style={styles.modalContainer}>
                        {buttonsVisible && (
                            <Animated.View style={[styles.modalHeader, {opacity: buttonsVisible ? 1 : 0}]}>
                                {isOwner && selectedPhoto && (
                                    <TouchableOpacity
                                        style={[styles.modalButton, styles.deleteButton]}
                                        onPress={handleDeletePress}
                                        disabled={deletingPhoto}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons name="trash" size={24} color="#ff3b30"/>
                                        <Text style={[styles.buttonText, {color: '#ffffff'}]}>Удалить</Text>
                                    </TouchableOpacity>
                                )}

                                <TouchableOpacity
                                    style={[styles.modalButton, !isOwner && styles.modalButtonCentered]}
                                    onPress={closeModal}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="close" size={24} color="white"/>
                                    <Text style={styles.buttonText}>Закрыть</Text>
                                </TouchableOpacity>
                            </Animated.View>
                        )}

                        <View style={styles.modalContent}>
                            {selectedPhoto && album && album.photos.length > 0 && (
                                <GestureDetector gesture={combinedGesture}>
                                    <View style={styles.imageContainer}>
                                        <Animated.Image
                                            source={{uri: selectedPhoto.image_url}}
                                            style={[styles.fullImage, animatedStyle]}
                                            resizeMode="contain"
                                        />

                                        {buttonsVisible && (
                                            <Animated.View style={[styles.photoIndicator, {opacity: buttonsVisible ? 1 : 0}]}>
                                                <Text style={styles.photoIndicatorText}>
                                                    {currentPhotoIndex + 1} / {album.photos.length}
                                                </Text>
                                            </Animated.View>
                                        )}

                                        {zoomLevel > 0 && buttonsVisible && (
                                            <Animated.View style={styles.zoomIndicator}>
                                                <Text style={styles.zoomIndicatorText}>
                                                    {zoomLevel === 1 ? '2x' : '3x'}
                                                </Text>
                                            </Animated.View>
                                        )}
                                    </View>
                                </GestureDetector>
                            )}

                            {buttonsVisible && selectedPhoto?.caption && (
                                <Animated.Text style={[styles.caption, {opacity: buttonsVisible ? 1 : 0}]}>
                                    {selectedPhoto.caption}
                                </Animated.Text>
                            )}

                            {buttonsVisible && selectedPhoto && (
                                <Animated.Text style={[styles.photoDate, {opacity: buttonsVisible ? 1 : 0}]}>
                                    {new Date(selectedPhoto.uploaded_at).toLocaleDateString('ru-RU', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        year: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </Animated.Text>
                            )}
                        </View>
                    </View>
                </Modal>

                <DeleteConfirmModal
                    visible={deleteConfirmVisible}
                    onCancel={handleDeleteCancel}
                    onConfirm={handleDeleteConfirm}
                    loading={deletingPhoto}
                />

                <PhotoUploadModal
                    visible={uploadModalVisible}
                    onClose={() => setUploadModalVisible(false)}
                    onPhotoUploaded={() => {
                        setUploadModalVisible(false);
                        fetchAlbum();
                    }}
                    albumId={albumId}
                />

                <AlbumEditModal
                    visible={editModalVisible}
                    album={album}
                    onClose={() => setEditModalVisible(false)}
                    onAlbumUpdated={handleAlbumUpdated}
                    onAlbumDeleted={handleAlbumDeleted}
                />
            </View>
            <TabBar/>
        </View>
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
        elevation: 2,
        shadowColor: theme.shadowColor || theme.text,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.2,
        shadowRadius: 2,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.border,
    },
    backButton: {
        marginRight: 16,
        padding: 8,
        borderRadius: 20,
        backgroundColor: theme.primary + '15',
    },
    headerInfo: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: theme.text,
    },
    headerSubtitle: {
        fontSize: 14,
        color: theme.textSecondary,
        marginTop: 2,
    },
    headerButtons: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerButton: {
        marginLeft: 12,
        padding: 8,
        borderRadius: 20,
        backgroundColor: theme.primary + '15',
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
    emptyPhotosContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    emptyText: {
        fontSize: 18,
        color: theme.textSecondary,
        marginTop: 16,
        marginBottom: 20,
        textAlign: 'center',
    },
    uploadFirstButton: {
        backgroundColor: theme.primary,
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderRadius: 8,
        marginBottom: 12,
    },
    uploadFirstButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    refreshButton: {
        backgroundColor: theme.success || '#34C759',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
    },
    refreshButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    photoList: {
        padding: 8,
    },
    photoItem: {
        width: photoSize,
        height: photoSize,
        margin: 2,
        borderRadius: 8,
        overflow: 'hidden',
    },
    photoImage: {
        width: '100%',
        height: '100%',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.95)',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingTop: 60,
        paddingBottom: 16,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 2,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
    },
    modalButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        gap: 6,
    },
    modalButtonCentered: {
        marginLeft: 'auto',
    },
    deleteButton: {
        backgroundColor: 'rgba(255, 59, 48, 0.8)',
    },
    buttonText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '500',
    },
    modalContent: {
        flex: 1,
        justifyContent: 'center',
    },
    imageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullImage: {
        width: width,
        height: height * 0.8,
    },
    photoIndicator: {
        position: 'absolute',
        bottom: 120,
        alignSelf: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
    },
    photoIndicatorText: {
        color: 'white',
        fontSize: 14,
        fontWeight: '500',
    },
    zoomIndicator: {
        position: 'absolute',
        top: 120,
        right: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
    },
    zoomIndicatorText: {
        color: 'white',
        fontSize: 12,
        fontWeight: '500',
    },
    caption: {
        color: 'white',
        fontSize: 16,
        textAlign: 'center',
        paddingHorizontal: 20,
        marginBottom: 8,
    },
    photoDate: {
        color: '#ccc',
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: 20,
        marginBottom: 60,
    },
    deleteModalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    deleteModalContent: {
        backgroundColor: theme.surface,
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        width: '100%',
        maxWidth: 320,
    },
    deleteModalIcon: {
        marginBottom: 16,
    },
    deleteModalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: theme.text,
        marginBottom: 8,
        textAlign: 'center',
    },
    deleteModalMessage: {
        fontSize: 16,
        color: theme.textSecondary,
        marginBottom: 24,
        textAlign: 'center',
    },
    deleteModalButtons: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    deleteModalButton: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    cancelButton: {
        backgroundColor: theme.border,
    },
    confirmButton: {
        backgroundColor: theme.error,
    },
    cancelButtonText: {
        color: theme.text,
        fontSize: 16,
        fontWeight: '600',
    },
    confirmButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
});