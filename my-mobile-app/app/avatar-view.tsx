import React from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
  Text,
  Dimensions,
  StatusBar
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

const { width, height } = Dimensions.get('window');

export default function AvatarView() {
  const { avatarUrl, username, isDefaultAvatar } = useLocalSearchParams<{
    avatarUrl: string;
    username: string;
    isDefaultAvatar: string;
  }>();

  const handleClose = () => {
    router.back();
  };

  const handleViewAlbums = () => {
    router.push(`/albums/${username}`);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      
      {/* Header with controls */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
          <Ionicons name="close" size={30} color="white" />
        </TouchableOpacity>
        
        <Text style={styles.username}>@{username}</Text>
        
        <TouchableOpacity style={styles.albumsButton} onPress={handleViewAlbums}>
          <Ionicons name="images-outline" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Full-screen avatar */}
      <View style={styles.imageContainer}>
        <Image
          source={
            isDefaultAvatar === 'true' || !avatarUrl
              ? require('../assets/avatar/male.png') // Default fallback
              : { uri: avatarUrl }
          }
          style={styles.avatar}
          resizeMode="contain"
        />
      </View>

      {/* Bottom controls */}
      <View style={styles.bottomControls}>
        <TouchableOpacity style={styles.controlButton} onPress={handleViewAlbums}>
          <Ionicons name="images-outline" size={20} color="white" />
          <Text style={styles.controlButtonText}>Альбомы</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  closeButton: {
    padding: 5,
  },
  username: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  albumsButton: {
    padding: 5,
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    width: width,
    height: width,
    maxHeight: height * 0.7,
  },
  bottomControls: {
    position: 'absolute',
    bottom: 50,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    marginHorizontal: 10,
  },
  controlButtonText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 16,
    fontWeight: '500',
  },
});