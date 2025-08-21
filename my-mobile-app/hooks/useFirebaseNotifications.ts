import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import FirebaseNotificationService from '../services/firebaseNotificationService';

interface NotificationStatus {
  isInitialized: boolean;
  hasPermission: boolean;
  token: string | null;
  tokenType: 'fcm' | 'expo' | null;
  isLoading: boolean;
  error: string | null;
}

export const useFirebaseNotifications = () => {
  const [status, setStatus] = useState<NotificationStatus>({
    isInitialized: false,
    hasPermission: false,
    token: null,
    tokenType: null,
    isLoading: true,
    error: null
  });

  const firebaseService = FirebaseNotificationService.getInstance();

  useEffect(() => {
    let mounted = true;

    const checkStatus = async () => {
      try {
        const serviceStatus = await firebaseService.getStatus();

        if (mounted) {
          setStatus({
            isInitialized: true,
            hasPermission: serviceStatus.hasPermission,
            token: serviceStatus.token,
            tokenType: serviceStatus.type,
            isLoading: false,
            error: null
          });
        }
      } catch (error) {
        if (mounted) {
          setStatus(prev => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      }
    };

    checkStatus();

    return () => {
      mounted = false;
    };
  }, []);

  const requestPermissions = async (): Promise<boolean> => {
    setStatus(prev => ({ ...prev, isLoading: true }));

    try {
      const granted = await firebaseService.requestPermissions();

      if (granted) {
        const newStatus = await firebaseService.getStatus();
        setStatus({
          isInitialized: true,
          hasPermission: newStatus.hasPermission,
          token: newStatus.token,
          tokenType: newStatus.type,
          isLoading: false,
          error: null
        });
      } else {
        setStatus(prev => ({
          ...prev,
          hasPermission: false,
          isLoading: false,
          error: 'Permission denied'
        }));
      }

      return granted;
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to request permissions'
      }));
      return false;
    }
  };

  const refreshToken = async (): Promise<string | null> => {
    setStatus(prev => ({ ...prev, isLoading: true }));

    try {
      const newToken = await firebaseService.refreshToken();
      const newStatus = await firebaseService.getStatus();

      setStatus({
        isInitialized: true,
        hasPermission: newStatus.hasPermission,
        token: newStatus.token,
        tokenType: newStatus.type,
        isLoading: false,
        error: null
      });

      return newToken;
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to refresh token'
      }));
      return null;
    }
  };

  const addMessageHandler = (handler: (message: any) => void) => {
    firebaseService.addMessageHandler(handler);
  };

  const removeMessageHandler = (handler: (message: any) => void) => {
    firebaseService.removeMessageHandler(handler);
  };

  return {
    ...status,
    requestPermissions,
    refreshToken,
    addMessageHandler,
    removeMessageHandler,
    // Полезные флаги
    isFirebaseEnabled: status.tokenType === 'fcm',
    isExpoFallback: status.tokenType === 'expo',
    canReceiveNotifications: status.hasPermission && status.token !== null
  };
};

export default useFirebaseNotifications;
