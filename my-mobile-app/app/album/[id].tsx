import React, {useState, useEffect, useCallback} from 'react';
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
    Dimensions,
    Modal
} from 'react-native';
import {router, useLocalSearchParams} from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import {Ionicons} from '@expo/vector-icons';
import {GestureDetector, Gesture, GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS
} from 'react-native-reanimated';
import PhotoUploadModal from '../../components/PhotoUploadModal';
import AlbumEditModal from '../../components/AlbumEditModal';
import {API_CONFIG} from '../../config';
import {useTheme} from '../../contexts/ThemeContext';
import CachedImage from "../../components/CachedImage";

const {width, height} = Dimensions.get('window');
const photoSize = (width - 48) / 3; // 3 columns with margins

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

// Кастомное модальное окно подтверждения удаления
const DeleteConfirmModal = ({
                                visible,
                                onCancel,
                                onConfirm,
                                loading,
                                theme
                            }: {
    visible: boolean;
    onCancel: () => void;
    onConfirm: () => void;
    loading: boolean;
    theme: any;
}) => {
    const modalStyles = createModalStyles(theme);

    return (
        <Modal
            visible={visible}
            transparent={true}
            animationType="fade"
            onRequestClose={onCancel}
        >
            <View style={modalStyles.deleteModalContainer}>
                <View style={modalStyles.deleteModalContent}>
                    <Ionicons name="warning" size={48} color={theme.error} style={modalStyles.deleteModalIcon}/>
                    <Text style={modalStyles.deleteModalTitle}>Удалить фотографию?</Text>
                    <Text style={modalStyles.deleteModalMessage}>Это действие нельзя отменить</Text>

                    <View style={modalStyles.deleteModalButtons}>
                        <TouchableOpacity
                            style={[modalStyles.deleteModalButton, modalStyles.cancelButton]}
                            onPress={onCancel}
                            disabled={loading}
                        >
                            <Text style={modalStyles.cancelButtonText}>Отмена</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[modalStyles.deleteModalButton, modalStyles.confirmButton]}
                            onPress={onConfirm}
                            disabled={loading}
                        >
                            {loading ? (
                                <ActivityIndicator size="small" color="white"/>
                            ) : (
                                <Text style={modalStyles.confirmButtonText}>Удалить</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
};

export default function AlbumDetail() {
    const {theme} = useTheme();
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
    const [buttonsVisible, setButtonsVisible] = useState(false);

    // Анимационные значения для масштабирования
    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const lastScale = useSharedValue(1);
    const lastTranslateX = useSharedValue(0);
    const lastTranslateY = useSharedValue(0);

    // Состояние для отслеживания уровня масштабирования
    const [zoomLevel, setZoomLevel] = useState(0); // 0 - обычный, 1 - увеличенный, 2 - максимальный

    // Анимированные значения для плавного появления кнопок
    const buttonsOpacity = useSharedValue(0);

    // Функции навигации по фотографиям (объявляем с useCallback)
    // Упрощенные функции навигации
    const goToNextPhoto = useCallback(() => {
        if (album && album.photos && currentPhotoIndex < album.photos.length - 1) {
            setCurrentPhotoIndex(currentPhotoIndex + 1);
            setSelectedPhoto(album.photos[currentPhotoIndex + 1]);
        }
    }, [album, currentPhotoIndex]);

    const goToPreviousPhoto = useCallback(() => {
        if (album && album.photos && currentPhotoIndex > 0) {
            setCurrentPhotoIndex(currentPhotoIndex - 1);
            setSelectedPhoto(album.photos[currentPhotoIndex - 1]);
        }
    }, [album, currentPhotoIndex]);

    // Функция для сброса масштабирования без изменения состояния кнопок
    const resetZoom = useCallback(() => {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        lastScale.value = 1;
        lastTranslateX.value = 0;
        lastTranslateY.value = 0;
        setZoomLevel(0);
        // Не меняем состояние кнопок здесь
    }, [scale, translateX, translateY, lastScale, lastTranslateX, lastTranslateY]);

    // Функция для установки конкретного уровня масштабирования
    const setZoom = useCallback((level: number) => {
        let targetScale = 1;
        switch (level) {
            case 1:
                targetScale = 2;
                break;
            case 2:
                targetScale = 3;
                break;
            default:
                targetScale = 1;
        }

        scale.value = withSpring(targetScale);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        lastScale.value = targetScale;
        lastTranslateX.value = 0;
        lastTranslateY.value = 0;
        setZoomLevel(level);
    }, [scale, translateX, translateY, lastScale, lastTranslateX, lastTranslateY]);

    // Функция для переключения видимости кнопок
    const toggleButtonsVisibility = useCallback(() => {
        const newValue = !buttonsVisible;
        setButtonsVisible(newValue);
        buttonsOpacity.value = withTiming(newValue ? 1 : 0, { duration: 500 });
    }, [buttonsVisible, buttonsOpacity]);

    // Функция для изменения уровня масштабирования
    const handleDoubleTap = useCallback(() => {
        const nextLevel = (zoomLevel + 1) % 3;
        setZoom(nextLevel);
    }, [zoomLevel, setZoom]);

    // Обработчик двойного нажатия
    const doubleTapGesture = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
            // Правильное использование runOnJS с функцией без параметров
            runOnJS(handleDoubleTap)();
        });

    // Обработчик одиночного нажатия для показа/скрытия кнопок
    const singleTapGesture = Gesture.Tap()
        .numberOfTaps(1)
        .maxDuration(250) // Короткое нажатие
        .onEnd(() => {
            runOnJS(toggleButtonsVisibility)();
        });

    // Обработчик жестов масштабирования (pinch)
    const pinchGesture = Gesture.Pinch()
        .onUpdate((event) => {
            scale.value = Math.max(0.5, Math.min(event.scale * lastScale.value, 5));
        })
        .onEnd(() => {
            lastScale.value = scale.value;
            // Обновляем уровень масштабирования на основе текущего масштаба
            if (scale.value <= 1.2) {
                runOnJS(setZoomLevel)(0);
            } else if (scale.value <= 2.5) {
                runOnJS(setZoomLevel)(1);
            } else {
                runOnJS(setZoomLevel)(2);
            }
        });
    // Убираем неиспользуемую функцию

    // Обработчик жестов перетаскивания
    // Создаем простую функцию для навигации
    const navigateToIndex = useCallback((newIndex: number) => {
        if (album && newIndex >= 0 && newIndex < album.photos.length) {
            setCurrentPhotoIndex(newIndex);
            setSelectedPhoto(album.photos[newIndex]);
        }
    }, [album]);

    // Переменная для отслеживания расстояния свайпа
    const translationX = useSharedValue(0);

    const panGesture = Gesture.Pan()
    .onBegin(() => {
        // Сбрасываем расстояние при начале свайпа
        translationX.value = 0;
    })
    .onUpdate((event) => {
        // Сохраняем текущее смещение
        translationX.value = event.translationX;

        if (scale.value > 1) {
            translateX.value = event.translationX + lastTranslateX.value;
            translateY.value = event.translationY + lastTranslateY.value;
        }
    })
    .onEnd((event) => {
        lastTranslateX.value = translateX.value;
        lastTranslateY.value = translateY.value;

        // Включаем перелистывание с простой реализацией
        if (scale.value <= 1.2) {
            const threshold = 50;

            if (Math.abs(event.translationX) > threshold) {

                if (event.translationX < -threshold) {
                    // Следующее фото (свайп влево)
                    runOnJS(navigateToIndex)(currentPhotoIndex + 1);
                } else if (event.translationX > threshold) {
                    // Предыдущее фото (свайп вправо)
                    runOnJS(navigateToIndex)(currentPhotoIndex - 1);
                }
            }
        }
    });



    // Исключаем конфликты между тапом и свайпом
    const tapGestures = Gesture.Exclusive(
        doubleTapGesture,
        singleTapGesture
    );

    // Комбинированный жест для масштабирования и панорамирования
    const zoomPanGestures = Gesture.Simultaneous(
        pinchGesture,
        panGesture
    );

    // Используем Race, чтобы только один из жестов сработал
    const combinedGesture = Gesture.Race(
        tapGestures,
        zoomPanGestures
    );

    // Анимированный стиль для изображения
    const animatedStyle = useAnimatedStyle(() => {
        return {
            transform: [
                {scale: scale.value},
                {translateX: translateX.value},
                {translateY: translateY.value},
            ],
        };
    });

    // Анимированный стиль для кнопок
    const buttonsAnimatedStyle = useAnimatedStyle(() => {
        return {
            opacity: buttonsOpacity.value,
        };
    });

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
                {
                    headers: {Authorization: `Token ${token}`}
                }
            );



            // Фильтруем фотографии, убираем те, у которых нет image_url
            const filteredPhotos = response.data.photos.filter((photo: Photo) =>
                photo.image_url && photo.thumbnail_url
            );



            setAlbum({
                ...response.data,
                photos: filteredPhotos
            });
        } catch (error) {
                // Ошибка получения альбома
            Alert.alert('Ошибка', 'Не удалось загрузить альбом');
            router.back();
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const deletePhoto = async () => {
        if (!selectedPhoto) return;

        console.log('🔴 Starting delete process for photo:', selectedPhoto.id);
        setDeletingPhoto(true);

        try {
            const token = await AsyncStorage.getItem('userToken');
            if (!token) {
                console.log('❌ No token found');
                Alert.alert('Ошибка', 'Необходимо войти в систему');
                return;
            }

            console.log('🔗 Sending DELETE request to:', `${API_CONFIG.BASE_URL}photo/${selectedPhoto.id}/`);

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

            // Фотография успешно удалена
            console.log('✅ Фотография успешно удалена');
            Alert.alert('Успех', 'Фотография удалена');

            // Закрываем все модальные окна
            setDeleteConfirmVisible(false);
            closeModal();

            // Обновляем альбом
            await fetchAlbum();

        } catch (error: any) {
            // Сохраняем только логирование ошибок
            console.error('Error deleting photo:', error);

            let errorMessage = 'Не удалось удалить фотографию';

            if (error.response) {
                switch (error.response.status) {
                    case 403:
                        errorMessage = 'У вас нет прав для удаления этой фотографии';
                        break;
                    case 404:
                        errorMessage = 'Фотография не найдена';
                        await fetchAlbum();
                        break;
                    case 500:
                        errorMessage = 'Внутренняя ошибка сервера';
                        break;
                    default:
                        errorMessage = `Ошибка сервера (${error.response.status})`;
                }
            } else if (error.request) {
                errorMessage = 'Сервер не отвечает. Проверьте подключение к интернету';
            } else {
                errorMessage = `Ошибка: ${error.message}`;
            }

            Alert.alert('Ошибка', errorMessage);
        } finally {
            setDeletingPhoto(false);
        }
    };

    const handleDeletePress = () => {
        console.log('🗑️ Delete button pressed');
        setDeleteConfirmVisible(true);
    };

    const handleDeleteConfirm = () => {
        console.log('✅ Delete confirmed');
        deletePhoto();
    };

    const handleDeleteCancel = () => {
        console.log('❌ Delete cancelled');
        setDeleteConfirmVisible(false);
    };

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

    // Безопасный сброс масштабирования при смене фото
    useEffect(() => {
        if (selectedPhoto) {
            try {
                // Безопасно сбрасываем масштаб
                scale.value = 1;
                translateX.value = 0;
                translateY.value = 0;
                lastScale.value = 1;
                lastTranslateX.value = 0;
                lastTranslateY.value = 0;
                setZoomLevel(0);
            } catch (error) {
                console.error('Error resetting zoom:', error);
            }
        }
    }, [selectedPhoto]);

    const handlePhotoPress = (photo: Photo, index: number) => {
        console.log('Photo pressed:', photo.id, 'at index:', index);
        setSelectedPhoto(photo);
        setCurrentPhotoIndex(index);
        setModalVisible(true);
        setButtonsVisible(false);
        buttonsOpacity.value = 0;
    };

    const closeModal = () => {
        console.log('Closing modal');
        setModalVisible(false);
        setSelectedPhoto(null);
        setDeleteConfirmVisible(false);
        resetZoom();
        setButtonsVisible(false);
        buttonsOpacity.value = 0;
    };

    const handleAlbumUpdated = () => {
        fetchAlbum();
    };

    const handleAlbumDeleted = () => {
        router.back();
    };

    const isOwner = currentUser && album && (
        currentUser === album.user?.username ||
        currentUser === (album as any).owner?.username ||
        currentUser === (album as any).creator?.username
    );

    const renderPhoto = ({item, index}: { item: Photo; index: number }) => {
        return (
            <TouchableOpacity
                style={styles.photoItem}
                onPress={() => {
                    console.log(`Photo ${item.id} pressed`);
                    handlePhotoPress(item, index);
                }}
                activeOpacity={0.8}
            >
                    <CachedImage
                        uri={item.thumbnail_url}
                    style={styles.photoImage}
                    resizeMode="cover"
                    onError={(error) => console.error('Image load error:', error)}
                />
            </TouchableOpacity>
        );
    };

    const albumId = id ? parseInt(id.toString(), 10) : undefined;
    const styles = createStyles(theme);

    if (loading) {
        return (
            <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.primary}/>
                <Text style={styles.loadingText}>Загрузка альбома...</Text>
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
                        keyExtractor={(item) => `album-${item.id}`}
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
                        columnWrapperStyle={styles.row}
                        removeClippedSubviews={false}
                        maxToRenderPerBatch={10}
                        windowSize={10}

                    />
                )}

                {/* Photo Modal - обновленная версия */}
                <Modal
                    visible={modalVisible}
                    transparent={true}
                    animationType="fade"
                    onRequestClose={closeModal}
                    statusBarTranslucent={true}>
                    <GestureHandlerRootView style={{flex: 1}}>

                        <View style={styles.modalContainer}>
                            {/* Кнопки вверху */}
                            {buttonsVisible && (
                                <Animated.View
                                    style={[
                                        styles.modalHeader,
                                        buttonsAnimatedStyle
                                    ]}
                                >
                                    {/* Кнопка удаления слева - показываем только владельцу */}
                                    {isOwner && selectedPhoto && (
                                        <TouchableOpacity
                                            style={[styles.modalButton, styles.deleteButton]}
                                            onPress={handleDeletePress}
                                            disabled={deletingPhoto}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="trash" size={24} color={theme.error}/>
                                        </TouchableOpacity>
                                    )}

                                    {/* Индикатор позиции фото по центру */}
                                    <Animated.View style={styles.photoIndicator}>
                                        <Text style={styles.photoIndicatorText}>
                                            {currentPhotoIndex + 1} / {album.photos.length}
                                        </Text>
                                    </Animated.View>

                                    {/* Кнопка закрытия справа */}
                                    <TouchableOpacity
                                        style={[
                                            styles.modalButton,
                                            !isOwner && styles.modalButtonCentered
                                        ]}
                                        onPress={closeModal}
                                        activeOpacity={0.7}
                                    >
                                        <Ionicons name="close" size={24} color="white"/>
                                    </TouchableOpacity>
                                </Animated.View>
                            )}

                            {/* Контент */}
                            <View style={styles.modalContent}>
                                {/* Изображение с поддержкой жестов */}
                                {selectedPhoto && album && album.photos.length > 0 && (
                                    <GestureDetector gesture={combinedGesture}>
                                        <View style={styles.imageContainer}>
                                            <Animated.Image
                                                source={{uri: selectedPhoto.image_url}}
                                                style={[styles.fullImage, animatedStyle]}
                                                resizeMode="contain"
                                            />


                                            {/* Индикатор масштабирования */}
                                            {zoomLevel > 0 && buttonsVisible && (
                                                <Animated.View 
                                                    style={[
                                                        styles.zoomIndicator,
                                                        buttonsAnimatedStyle
                                                    ]}
                                                >
                                                    <Text style={styles.zoomIndicatorText}>
                                                        {zoomLevel === 1 ? '2x' : '3x'}
                                                    </Text>
                                                </Animated.View>
                                            )}

                                            {/* Дата поверх изображения */}
                                            {buttonsVisible && selectedPhoto && (
                                                <Animated.View
                                                    style={[
                                                        styles.photoDateOverlay,
                                                        buttonsAnimatedStyle
                                                    ]}
                                                >
                                                    <Text style={styles.photoDateOverlayText}>
                                                        {new Date(selectedPhoto.uploaded_at).toLocaleDateString('ru-RU', {
                                                            day: '2-digit',
                                                            month: '2-digit',
                                                            year: 'numeric',
                                                            hour: '2-digit',
                                                            minute: '2-digit'
                                                        })}
                                                    </Text>
                                                </Animated.View>
                                            )}


                                        </View>
                                    </GestureDetector>
                                )}

                                {/* Информация */}
                                {buttonsVisible && selectedPhoto?.caption && (
                                    <Animated.Text
                                        style={[
                                            styles.caption,
                                            buttonsAnimatedStyle
                                        ]}
                                    >
                                        {selectedPhoto.caption}
                                    </Animated.Text>
                                )}

                            </View>
                        </View>
                    </GestureHandlerRootView>

                </Modal>

                {/* Кастомное модальное окно подтверждения удаления */}
                <DeleteConfirmModal
                    visible={deleteConfirmVisible}
                    onCancel={handleDeleteCancel}
                    onConfirm={handleDeleteConfirm}
                    loading={deletingPhoto}
                    theme={theme}
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
    row: {
        justifyContent: 'space-around',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.surface,
        paddingHorizontal: 16,
        paddingVertical: 12,
        paddingTop: 50,
        elevation: 2,
        shadowColor: theme.shadow,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.2,
        shadowRadius: 2,
        borderBottomWidth: 1,
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
        backgroundColor: theme.success,
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
        padding: 16,
    },
    photoItem: {
        width: photoSize,
        height: photoSize,
        margin: 2,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: theme.surface,
        elevation: 2,
        shadowColor: theme.shadow,
        shadowOffset: {width: 0, height: 1},
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    photoImage: {
        width: '100%',
        height: '100%',
    },
    // Стили для модального окна просмотра фото
    modalContainer: {
        flex: 1,
        backgroundColor: theme.overlay,
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        paddingHorizontal: 20,
        paddingVertical: 15,
        paddingTop: 60,
        position: 'absolute',
        top: 0,
        zIndex: 10,
    },
    modalContent: {
        flex: 1,
        width: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalButton: {
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        padding: 12,
        borderRadius: 25,
        justifyContent: 'center',
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: {width: 0, height: 2},
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    modalButtonCentered: {
        marginLeft: 'auto',
    },
    deleteButton: {
        borderWidth: 2,
        borderColor: theme.error,
    },
    buttonText: {
        color: 'white',
        marginLeft: 8,
        fontSize: 15,
        fontWeight: '600',
    },
    imageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        width: '100%',
    },
    fullImage: {
        width: '100%',
        height: '100%',
        borderRadius: 12,
    },
    photoIndicator: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 15,
        paddingVertical: 8,
        marginHorizontal: 10,
    },
    photoIndicatorText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
        textShadowColor: 'rgba(0, 0, 0, 0.75)',
        textShadowOffset: {width: 1, height: 1},
        textShadowRadius: 3,
    },
    zoomIndicator: {
        position: 'absolute',
        top: 20,
        right: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 15,
    },
    zoomIndicatorText: {
        color: 'white',
        fontSize: 14,
        fontWeight: 'bold',
    },
    caption: {
        color: 'white',
        fontSize: 16,
        textAlign: 'center',
        position: 'absolute',
        bottom: 80,
        left: 20,
        right: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        paddingVertical: 10,
        paddingHorizontal: 20,
        borderRadius: 8,
    },
    photoDate: {
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: 13,
        textAlign: 'center',
        marginTop: 8,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
    },
    photoDateOverlay: {
        position: 'absolute',
        bottom: 20,
        alignSelf: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 15,
    },
    photoDateOverlayText: {
        color: 'white',
        fontSize: 13,
        fontWeight: '500',
    },
});

// Стили для модального окна подтверждения удаления
const createModalStyles = (theme: any) => StyleSheet.create({
    deleteModalContainer: {
        flex: 1,
        backgroundColor: theme.overlay,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    deleteModalContent: {
        backgroundColor: theme.surface,
        borderRadius: 16,
        padding: 24,
        width: '100%',
        maxWidth: 320,
        alignItems: 'center',
        elevation: 8,
        shadowColor: theme.shadow,
        shadowOffset: {width: 0, height: 4},
        shadowOpacity: 0.3,
        shadowRadius: 8,
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
        lineHeight: 22,
    },
    deleteModalButtons: {
        flexDirection: 'row',
        width: '100%',
        gap: 12,
    },
    deleteModalButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 44,
    },
    cancelButton: {
        backgroundColor: theme.border,
        borderWidth: 1,
        borderColor: theme.border,
    },
    cancelButtonText: {
        color: theme.text,
        fontSize: 16,
        fontWeight: '600',
    },
    confirmButton: {
        backgroundColor: theme.error,
    },
    confirmButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
});