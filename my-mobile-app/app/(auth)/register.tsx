import React, { useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Image,
  Platform,
  Modal,
} from 'react-native';
import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from "expo-router";
import { Link } from "expo-router";
import { API_CONFIG } from '../../config';
import * as ImagePicker from 'expo-image-picker';
import { Picker } from '@react-native-picker/picker';
import { useTheme } from '../../contexts/ThemeContext';

interface Theme {
  background: string;
  surface: string;
  primary: string;
  text: string;
  textSecondary: string;
  border: string;
  placeholder: string;
}

interface RegisterResponse {
  token: string;
  user: {
    id: number;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    gender: string;
    birthday: string;
    avatar_url: string;
  };
}

export default function Register() {
  const { theme } = useTheme();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [gender, setGender] = useState('male');
  const [birthday, setBirthday] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [day, setDay] = useState('1');
  const [month, setMonth] = useState('1');
  const [year, setYear] = useState('2000');
  const [loading, setLoading] = useState(false);

  const styles = createStyles(theme);

  const validateForm = () => {
    if (!username.trim()) {
      Alert.alert('Ошибка', 'Введите имя пользователя');
      return false;
    }
    if (!email.trim()) {
      Alert.alert('Ошибка', 'Введите email');
      return false;
    }
    if (!email.includes('@')) {
      Alert.alert('Ошибка', 'Введите корректный email');
      return false;
    }
    if (!password) {
      Alert.alert('Ошибка', 'Введите пароль');
      return false;
    }
    if (password.length < 6) {
      Alert.alert('Ошибка', 'Пароль должен содержать минимум 6 символов');
      return false;
    }
    if (password !== confirmPassword) {
      Alert.alert('Ошибка', 'Пароли не совпадают');
      return false;
    }
    if (!firstName.trim()) {
      Alert.alert('Ошибка', 'Введите имя');
      return false;
    }
    if (!lastName.trim()) {
      Alert.alert('Ошибка', 'Введите фамилию');
      return false;
    }
    if (!birthday) {
      Alert.alert('Ошибка', 'Выберите дату рождения');
      return false;
    }
    return true;
  };
  
  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      
      if (!result.canceled) {
        setAvatar(result.assets[0]);
      }
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось выбрать изображение');
    }
  };
  
  const handleDateConfirm = () => {
    const selectedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    setBirthday(selectedDate);
    setShowDatePicker(false);
  };
  
  const formatBirthday = (dateString: string) => {
    if (!dateString) return 'Выберите дату рождения';
    
    const [year, month, day] = dateString.split('-');
    return `${day}.${month}.${year}`;
  };

  const handleRegister = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      // Create FormData object to send multipart/form-data (for file upload)
      const formData = new FormData();
      
      // Add text fields
      formData.append('username', username.trim());
      formData.append('email', email.trim());
      formData.append('password', password);
      formData.append('password_confirm', confirmPassword);
      formData.append('first_name', firstName.trim());
      formData.append('last_name', lastName.trim());
      formData.append('gender', gender);
      if (birthday) {
        formData.append('birthday', birthday);
      }
      
      // Add avatar if selected
      if (avatar) {
        const fileExtension = avatar.uri.split('.').pop() || 'jpg';
        const fileName = `avatar-${Date.now()}.${fileExtension}`;
        
        formData.append('avatar', {
          uri: avatar.uri,
          name: fileName,
          type: `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`
        } as any);
      }
      
      const response = await axios.post<RegisterResponse & { requires_verification?: boolean }>(
        `${API_CONFIG.BASE_URL}/authentication/api/register/`, 
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      const { token, user } = response.data;

      // Сохраняем токен
      await AsyncStorage.setItem('userToken', token);

      // Сохраняем данные пользователя
      await AsyncStorage.setItem('userData', JSON.stringify(user));

      // Устанавливаем токен для будущих запросов
      axios.defaults.headers.common['Authorization'] = `Token ${token}`;

      // Проверяем, требуется ли подтверждение email
      if (response.data.requires_verification) {
        Alert.alert('Успех', 'Регистрация прошла успешно! Пожалуйста, подтвердите ваш email.', [
          {
            text: 'OK',
            onPress: () => router.push({
              pathname: '/(auth)/confirm-email',
              params: { email: user.email }
            }),
          },
        ]);
      } else {
        Alert.alert('Успех', 'Регистрация прошла успешно!', [
          {
            text: 'OK',
            onPress: () => router.replace('/(main)/feed'),
          },
        ]);
      }
    } catch (error) {
      const axiosError = error as AxiosError<{ error?: string; [key: string]: any }>;
      let errorMessage = 'Произошла ошибка при регистрации';
      
      if (axiosError.response?.data) {
        const data = axiosError.response.data;
        if (data.error) {
          errorMessage = data.error;
        } else if (data.username) {
          errorMessage = `Имя пользователя: ${data.username[0]}`;
        } else if (data.email) {
          errorMessage = `Email: ${data.email[0]}`;
        } else if (data.password) {
          errorMessage = `Пароль: ${data.password[0]}`;
        } else if (data.first_name) {
          errorMessage = `Имя: ${data.first_name[0]}`;
        } else if (data.last_name) {
          errorMessage = `Фамилия: ${data.last_name[0]}`;
        } else if (data.gender) {
          errorMessage = `Пол: ${data.gender[0]}`;
        } else if (data.birthday) {
          errorMessage = `Дата рождения: ${data.birthday[0]}`;
        } else if (data.avatar) {
          errorMessage = `Фото: ${data.avatar[0]}`;
        }
      }
      
      Alert.alert('Ошибка', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Регистрация</Text>
      
      <Text style={styles.label}>Имя пользователя *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Введите имя пользователя"
        placeholderTextColor={theme.placeholder}
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />

      <Text style={styles.label}>Email *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Введите email адрес"
        placeholderTextColor={theme.placeholder}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        editable={!loading}
      />

      <Text style={styles.label}>Имя *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Введите ваше имя"
        placeholderTextColor={theme.placeholder}
        value={firstName}
        onChangeText={setFirstName}
        autoCorrect={false}
        editable={!loading}
      />

      <Text style={styles.label}>Фамилия *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Введите вашу фамилию"
        placeholderTextColor={theme.placeholder}
        value={lastName}
        onChangeText={setLastName}
        autoCorrect={false}
        editable={!loading}
      />
      
      <Text style={styles.label}>Пол *</Text>
      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={gender}
          onValueChange={(itemValue) => setGender(itemValue)}
          style={[styles.picker, { color: theme.text }]}
          enabled={!loading}
        >
          <Picker.Item label="Мужчина" value="male" />
          <Picker.Item label="Женщина" value="female" />
        </Picker>
      </View>

      <Text style={styles.label}>Дата рождения *</Text>
      <TouchableOpacity 
        style={styles.input}
        onPress={() => setShowDatePicker(true)}
        disabled={loading}
      >
        <Text style={birthday ? [styles.inputText, { color: theme.text }] : [styles.placeholderText, { color: theme.placeholder }]}>
          {birthday ? formatBirthday(birthday) : 'Выберите дату рождения'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.label}>Фото профиля</Text>
      <TouchableOpacity 
        style={styles.avatarContainer}
        onPress={pickImage}
        disabled={loading}
      >
        {avatar ? (
          <Image source={{ uri: avatar.uri }} style={styles.avatar} />
        ) : (
          <Image 
            source={
              gender === 'male'
                ? require('../../assets/avatar/male.png')
                : require('../../assets/avatar/female.png')
            }
            style={styles.avatar}
          />
        )}
        <Text style={[styles.avatarHint, { color: theme.textSecondary }]}>Нажмите для выбора фото</Text>
      </TouchableOpacity>

      <Text style={styles.label}>Пароль *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Введите пароль (минимум 6 символов)"
        placeholderTextColor={theme.placeholder}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />

      <Text style={styles.label}>Подтвердите пароль *</Text>
      <TextInput
        style={[styles.input, { color: theme.text }]}
        placeholder="Повторите пароль"
        placeholderTextColor={theme.placeholder}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      
      <TouchableOpacity 
        style={[styles.button, loading && styles.disabledButton]} 
        onPress={handleRegister}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>Зарегистрироваться</Text>
        )}
      </TouchableOpacity>
      
      <View style={styles.linkContainer}>
        <Text style={styles.linkText}>Уже есть аккаунт? </Text>
        <Link href="/(auth)/login" style={styles.link}>
          Войти
        </Link>
      </View>
      
      {/* Date Picker Modal */}
      <Modal
        visible={showDatePicker}
        transparent={true}
        animationType="slide"
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Выберите дату рождения</Text>
            
            <View style={styles.datePickerContainer}>
              {/* Day Picker */}
              <View style={styles.datePickerColumn}>
                <Text style={styles.datePickerLabel}>День</Text>
                <Picker
                  selectedValue={day}
                  onValueChange={(value) => setDay(value)}
                  style={styles.datePicker}
                >
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                    <Picker.Item key={d} label={d.toString()} value={d.toString()} />
                  ))}
                </Picker>
              </View>
              
              {/* Month Picker */}
              <View style={styles.datePickerColumn}>
                <Text style={styles.datePickerLabel}>Месяц</Text>
                <Picker
                  selectedValue={month}
                  onValueChange={(value) => setMonth(value)}
                  style={styles.datePicker}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <Picker.Item key={m} label={m.toString()} value={m.toString()} />
                  ))}
                </Picker>
              </View>
              
              {/* Year Picker */}
              <View style={styles.datePickerColumn}>
                <Text style={styles.datePickerLabel}>Год</Text>
                <Picker
                  selectedValue={year}
                  onValueChange={(value) => setYear(value)}
                  style={styles.datePicker}
                >
                  {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                    <Picker.Item key={y} label={y.toString()} value={y.toString()} />
                  ))}
                </Picker>
              </View>
            </View>
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelButton]} 
                onPress={() => setShowDatePicker(false)}
              >
                <Text style={styles.modalButtonText}>Отмена</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={[styles.modalButton, styles.confirmButton]} 
                onPress={handleDateConfirm}
              >
                <Text style={styles.modalButtonText}>Подтвердить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const createStyles = (theme: Theme) => StyleSheet.create({
  container: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: theme.background,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
    color: theme.text,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
    color: theme.text,
  },
  input: {
    backgroundColor: theme.surface,
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    fontSize: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  inputText: {
    fontSize: 16,
  },
  placeholderText: {
    fontSize: 16,
  },
  pickerContainer: {
    backgroundColor: theme.surface,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 10,
  },
  picker: {
    height: 50,
  },
  avatarContainer: {
    alignSelf: 'center',
    marginBottom: 20,
    alignItems: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: theme.primary,
  },
  avatarHint: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  button: {
    backgroundColor: theme.primary,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  disabledButton: {
    backgroundColor: theme.textSecondary,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  linkContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
  },
  linkText: {
    fontSize: 16,
    color: theme.textSecondary,
  },
  link: {
    fontSize: 16,
    color: theme.primary,
    fontWeight: '500',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: theme.text,
  },
  datePickerContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  datePickerColumn: {
    flex: 1,
    alignItems: 'center',
  },
  datePickerLabel: {
    fontSize: 16,
    marginBottom: 5,
    color: theme.text,
  },
  datePicker: {
    width: '100%',
    height: 150,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    flex: 1,
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  cancelButton: {
    backgroundColor: theme.textSecondary,
  },
  confirmButton: {
    backgroundColor: theme.primary,
  },
  modalButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});