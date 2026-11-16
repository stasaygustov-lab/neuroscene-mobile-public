import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder } from 'react-native';
import { useEvent } from 'expo';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
  ActivityIndicator,
  Image,
  ImageBackground,
  Dimensions,
  Linking,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { File as ExpoFile, Paths as ExpoPaths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { fetch as expoFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { faqText, uiText } from './localization';

const VK_CLIENT_ID = process.env.EXPO_PUBLIC_VK_CLIENT_ID || '';
const VK_REDIRECT_URI = VK_CLIENT_ID ? `vk${VK_CLIENT_ID}://vk.ru/blank.html` : '';
const SESSION_STORAGE_KEY = 'neuroscene.session';
const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || '').replace(/\/+$/, '');

const StyledText = Text as typeof Text & { defaultProps?: any };
StyledText.defaultProps = {
  ...(StyledText.defaultProps || {}),
  style: [{ fontFamily: 'sans-serif' }, StyledText.defaultProps?.style],
};

const BLUE = '#168BFF';
const BG = '#020713';
const PANEL = '#071A34';
const MUTED = '#9CB9D8';
const WHITE = '#FFFFFF';

const REFERENCE_HERO_SOURCE = require('./assets/neuroscene-create-hero.webp');

const RECOMMENDED_PROMPTS = [
  'A lone astronaut walks through a vast abandoned cathedral on an alien planet, soft shafts of blue light cut through drifting dust, slow cinematic dolly-in, photorealistic, atmospheric science-fiction film.',
  'A black sports car races through a rain-soaked neon city at night, reflections shimmer across the asphalt, dynamic low tracking shot, realistic motion blur, premium action-film cinematography.',
  'A medieval warrior stands on a windswept cliff above a stormy sea, cloak moving naturally in the wind, distant lightning illuminates the clouds, slow dramatic camera orbit, photorealistic epic cinema.',
  'A tiny coastal village at sunrise, warm light slowly spreads across old rooftops, sea mist drifts between the houses, gentle aerial camera movement, natural colors, cinematic realism.',
  'A secret agent walks calmly through a crowded futuristic train station as the world moves around him, subtle handheld camera, shallow depth of field, tense thriller atmosphere, photorealistic.',
  'An enormous ancient tree rises from the center of a forgotten city, leaves and hanging roots move in the breeze, camera slowly cranes upward to reveal its scale, magical realism, cinematic detail.',
  'A helicopter flies between snow-covered mountain peaks at dawn, rotor wash lifts loose snow, wide aerial tracking shot, realistic physics, high-end documentary cinematography.',
  'A woman in a red coat walks through a quiet Tokyo alley in the rain, glowing signs reflect in puddles, slow side-tracking shot, natural human movement, photorealistic neo-noir film.'
];

type Tab = 'Create' | 'Gallery' | 'Credits' | 'Profile';
type Language = 'ru';

type GenerationType = 't2v' | 'i2v';

type JobStatus =
  | 'idle'
  | 'queued'
  | 'starting'
  | 'generating'
  | 'uploading'
  | 'completed'
  | 'failed';

function readVideoUrl(data: any): string | null {
  if (!data || typeof data !== 'object') return null;

  const keys = [
    'result_url',
    'video_url',
    'output_url',
    'media_url',
    'url',
  ];

  for (const key of keys) {
    if (typeof data[key] === 'string' && data[key].length > 0) {
      const value = data[key];

      if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
      }

      if (value.startsWith('/')) {
        return `${API_BASE_URL}${value}`;
      }
    }
  }

  for (const value of Object.values(data)) {
    if (value && typeof value === 'object') {
      const found = readVideoUrl(value);
      if (found) return found;
    }
  }

  return null;
}

function readJobStatus(data: any): string {
  if (!data || typeof data !== 'object') return '';

  const value = data.status || data.state || data.job_status;

  if (typeof value === 'string') return value.toLowerCase();

  return '';
}

function readJobId(data: any): string | null {
  if (!data || typeof data !== 'object') return null;

  const value = data.job_id || data.id || data.generation_id;

  return typeof value === 'string' ? value : null;
}

async function readResponse(response: Response): Promise<any> {
  const text = await response.text();

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { detail: text };
  }
}

function ScreenTransition({ children }: { children: any }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(9)).current;

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 240, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 260, useNativeDriver: true }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      opacity.stopAnimation();
      translateY.stopAnimation();
    };
  }, [opacity, translateY]);

  return (
    <Animated.View style={{ flex: 1, opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Create');
  const swipeResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dx) > 48 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) < 72) return;
      const order: Tab[] = ['Create', 'Gallery', 'Credits', 'Profile'];
      setTab((currentTab) => {
        const current = order.indexOf(currentTab);
        const next = Math.max(0, Math.min(order.length - 1, current + (gesture.dx < 0 ? 1 : -1)));
        if (next === current) return currentTab;
        setShowSupport(false);
        setShowNotifications(false);
        setShowFaq(false);
        setShowAdminPanel(false);
        return order[next];
      });
    },
  })).current;
  const language: Language = 'ru';
  const [generationType, setGenerationType] = useState<GenerationType>('t2v');
  const [sourceImage, setSourceImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [duration, setDuration] = useState(5);
  const [ratio, setRatio] = useState('16:9');
  const [prompt, setPrompt] = useState(() => RECOMMENDED_PROMPTS[Math.floor(Math.random() * RECOMMENDED_PROMPTS.length)]);
  const [enhancedPrompt, setEnhancedPrompt] = useState('');
  const [promptEnhancing, setPromptEnhancing] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<any | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [profileEmailOpen, setProfileEmailOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle');
  const [jobMessage, setJobMessage] = useState('');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pollError, setPollError] = useState('');
  const [galleryItems, setGalleryItems] = useState<any[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const [creditHistory, setCreditHistory] = useState<any[]>([]);
  const [creditsLoading, setCreditsLoading] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [adminAudit, setAdminAudit] = useState<any[]>([]);
  const [adminGenerations, setAdminGenerations] = useState<any[]>([]);
  const [adminWorkers, setAdminWorkers] = useState<any[]>([]);
  const [adminAnalytics, setAdminAnalytics] = useState<any | null>(null);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const notificationRefreshRef = useRef<(() => Promise<void>) | null>(null);
  const notificationRefreshBusyRef = useRef(false);
  const [supportTickets, setSupportTickets] = useState<any[]>([]);
  const [selectedSupportTicket, setSelectedSupportTicket] = useState<any | null>(null);
  const [supportCategory, setSupportCategory] = useState<'generation' | 'payment' | 'account' | 'other'>('generation');
  const [supportFilter, setSupportFilter] = useState<'new' | 'in_progress' | 'closed'>('new');
  const [supportDescription, setSupportDescription] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [supportFiles, setSupportFiles] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportBusy, setSupportBusy] = useState(false);
  const [supportError, setSupportError] = useState('');
  const [showFaq, setShowFaq] = useState(false);
  const [faqItems, setFaqItems] = useState<any[]>([]);
  const [faqLoading, setFaqLoading] = useState(false);
  const [faqError, setFaqError] = useState('');
  const [showIntro, setShowIntro] = useState(true);
  const splashProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(splashProgress, {
      toValue: 1,
      duration: 3200,
      useNativeDriver: false,
    });
    animation.start();
    const splashTimer = setTimeout(() => setShowIntro(false), 3200);
    return () => {
      animation.stop();
      clearTimeout(splashTimer);
    };
  }, [splashProgress]);


  const saveAuthenticatedSession = async (data: any) => {
    if (!data?.access_token || !data?.user) {
      throw new Error('Сервер вернул неполные данные авторизации');
    }
    await SecureStore.setItemAsync(SESSION_STORAGE_KEY, data.access_token);
    setAuthToken(data.access_token);
    setAuthUser(data.user);
    setPrompt(RECOMMENDED_PROMPTS[Math.floor(Math.random() * RECOMMENDED_PROMPTS.length)]);
    setAuthPassword('');
    setAuthNotice('');
    setPendingEmail('');
    setTab('Gallery');
  };

  const handleEmailVerificationLink = async (url: string) => {
    try {
      const parsed = new URL(url);
      const isVerification = url.startsWith('neuroscene://verify-email') || parsed.hostname === 'verify-email';
      const isLogin = url.startsWith('neuroscene://login') || parsed.hostname === 'login';
      if (!isVerification && !isLogin) return;
      const token = parsed.searchParams.get('token');
      if (!token) return;
      setAuthBusy(true);
      const endpoint = isLogin ? 'login-link/consume' : 'verify-email';
      const response = await fetch(`${API_BASE_URL}/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || (isLogin ? 'Не удалось выполнить вход' : 'Не удалось подтвердить email'));
      await saveAuthenticatedSession(data);
      Alert.alert(
        isLogin ? (language === 'ru' ? 'Вход выполнен' : 'Вход выполнен') : 'Почта подтверждена',
        isLogin
          ? (language === 'ru' ? 'Вы вошли в НейроСцену.' : 'You are now signed in to NeuroScene.')
          : 'Аккаунт активирован. Добро пожаловать в НейроСцену!'
      );
    } catch (error) {
      Alert.alert('НейроСцена', error instanceof Error ? error.message : 'Неизвестная ошибка');
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const restoreSession = async () => {
      try {
        const savedToken = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
        if (!savedToken) return;
        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}`, Accept: 'application/json' },
        });
        const data = await readResponse(response);
        if (!response.ok) {
          await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
          return;
        }
        if (mounted) {
          setAuthToken(savedToken);
          setAuthUser(data.user);
          setTab('Gallery');
        }
      } catch {
        await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY).catch(() => undefined);
      } finally {
        if (mounted) setAuthReady(true);
      }
    };
    restoreSession();
    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleEmailVerificationLink(url);
    });
    Linking.getInitialURL().then((url) => {
      if (url) void handleEmailVerificationLink(url);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  const handleAuthSubmit = async () => {
    const email = authEmail.trim().toLowerCase();
    if (!email || !authPassword) {
      setAuthNotice(language === 'ru' ? 'Укажи email и пароль.' : 'Enter your email and password.');
      return;
    }
    if (authMode === 'register' && authPassword.length < 12) {
      setAuthNotice(language === 'ru' ? 'Пароль должен содержать минимум 12 символов.' : 'Password must contain at least 12 characters.');
      return;
    }
    setAuthBusy(true);
    setAuthNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/${authMode === 'register' ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, password: authPassword }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      if (authMode === 'register') {
        setPendingEmail(email);
        setAuthPassword('');
        setAuthNotice(data.message || (language === 'ru' ? 'Проверь почту и подтверди адрес.' : 'Check your inbox to verify your email.'));
      } else {
        await saveAuthenticatedSession(data);
      }
    } catch (error) {
      if (authMode === 'register' || (error instanceof Error && error.message.toLowerCase().includes('подтвердите email'))) {
        setPendingEmail(email);
      }
      setAuthNotice(error instanceof Error ? error.message : 'Неизвестная ошибка');
    } finally {
      setAuthBusy(false);
    }
  };

  const requestEmailLoginLink = async () => {
    const email = authEmail.trim().toLowerCase();
    if (!email) {
      setAuthNotice(language === 'ru' ? 'Сначала укажи email.' : 'Enter your email first.');
      return;
    }
    setAuthBusy(true);
    setAuthNotice('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      setPendingEmail(email);
      setAuthNotice(data.message || (language === 'ru' ? 'Если аккаунт существует, ссылка отправлена.' : 'If the account exists, a sign-in link has been sent.'));
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Не удалось запросить ссылку входа.');
    } finally {
      setAuthBusy(false);
    }
  };

  const resendVerification = async () => {
    const email = pendingEmail || authEmail.trim().toLowerCase();
    if (!email) return;
    setAuthBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || 'Не удалось отправить письмо');
      setAuthNotice(data.message || 'Если аккаунт ожидает подтверждения, письмо отправлено.');
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Неизвестная ошибка');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleVkLogin = async () => {
    setAuthBusy(true);
    setAuthNotice('');
    try {
      if (!VK_CLIENT_ID || !VK_REDIRECT_URI) {
        throw new Error('Вход через VK ID пока не настроен в конфигурации приложения.');
      }
      const startResponse = await fetch(`${API_BASE_URL}/api/auth/vk/start`);
      const startData = await readResponse(startResponse);
      if (!startResponse.ok) throw new Error(startData.detail || 'VK ID пока не настроен');
      if (startData.redirect_uri !== VK_REDIRECT_URI) throw new Error('Адрес возврата VK ID не совпадает с настройкой приложения.');
      const result = await WebBrowser.openAuthSessionAsync(startData.authorization_url, VK_REDIRECT_URI);
      if (result.type !== 'success' || !result.url) return;
      const callback = new URL(result.url);
      let code = callback.searchParams.get('code') || '';
      let state = callback.searchParams.get('state') || '';
      let deviceId = callback.searchParams.get('device_id') || '';
      const payload = callback.searchParams.get('payload');
      if (payload) {
        try {
          const decoded = JSON.parse(payload);
          code = code || decoded.code || '';
          state = state || decoded.state || '';
          deviceId = deviceId || decoded.device_id || '';
        } catch {
          throw new Error('VK ID вернул некорректный ответ.');
        }
      }
      const completeResponse = await fetch(`${API_BASE_URL}/api/auth/vk/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, state, device_id: deviceId }),
      });
      const completeData = await readResponse(completeResponse);
      if (!completeResponse.ok) throw new Error(completeData.detail || 'Не удалось войти через VK ID');
      await saveAuthenticatedSession(completeData);
    } catch (error) {
      setAuthNotice(error instanceof Error ? error.message : 'Ошибка входа через VK ID');
    } finally {
      setAuthBusy(false);
    }
  };

  const logoutAllDevices = async () => {
    let revoked = false;
    try {
      if (authToken) {
        const response = await fetch(`${API_BASE_URL}/api/auth/logout-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
        revoked = response.ok;
        if (!response.ok) throw new Error('Сервер не подтвердил выход со всех устройств.');
      }
    } catch (error) {
      Alert.alert(
        language === 'ru' ? 'Не удалось завершить все сеансы' : 'Не удалось завершить все сеансы',
        error instanceof Error ? error.message : 'Проверь подключение к серверу.'
      );
    } finally {
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
      setAuthToken(null);
      setAuthUser(null);
      setGalleryItems([]);
      setCreditsBalance(null);
      setCreditHistory([]);
      setNotifications([]);
      setUnreadNotifications(0);
      setSupportTickets([]);
      setSelectedSupportTicket(null);
      setAdminUsers([]);
      setAdminAudit([]);
       setAdminGenerations([]);
       setAdminWorkers([]);
       setAdminAnalytics(null);
      setShowAdminPanel(false);
      setShowSupport(false);
      setShowNotifications(false);
      setTab('Create');
      setAuthNotice(revoked
        ? (language === 'ru' ? 'Вы вышли из аккаунта на всех устройствах.' : 'You signed out on all devices.')
        : (language === 'ru' ? 'Выход выполнен на этом устройстве. Остальные сеансы могли сохраниться.' : 'Signed out on this device. Other sessions may remain active.'));
    }
  };


  const deleteAccount = () => {
    Alert.alert(
      language === 'ru' ? 'Удалить аккаунт?' : 'Delete account?',
      language === 'ru'
        ? 'Профильные данные, история и все видео в галерее будут удалены без возможности восстановления. Финансовые записи, которые необходимо хранить, останутся без прямых личных идентификаторов.'
        : 'Your profile data, history and gallery videos will be permanently deleted. Legally required financial records will be retained without direct personal identifiers.',
      [
        { text: language === 'ru' ? 'Отмена' : 'Cancel', style: 'cancel' },
        {
          text: language === 'ru' ? 'Удалить аккаунт' : 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setAuthBusy(true);
            try {
              const response = await fetch(`${API_BASE_URL}/api/auth/account`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${authToken}` },
              });
              const data = await readResponse(response);
              if (!response.ok) throw new Error(data.detail || 'Не удалось удалить аккаунт');
              await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY);
              setAuthToken(null);
              setAuthUser(null);
              setAuthPassword('');
              setPendingEmail('');
              setGalleryItems([]);
              setCreditsBalance(null);
              setCreditHistory([]);
              setNotifications([]);
              setUnreadNotifications(0);
              setSupportTickets([]);
              setSelectedSupportTicket(null);
              setAdminUsers([]);
              setAdminAudit([]);
       setAdminGenerations([]);
       setAdminWorkers([]);
       setAdminAnalytics(null);
              setShowAdminPanel(false);
       setShowFaq(false);
       setFaqItems([]);
              setShowSupport(false);
              setShowNotifications(false);
              setVideoUrl(null);
              setJobId(null);
              setTab('Create');
              Alert.alert(
                language === 'ru' ? 'Аккаунт удалён' : 'Account deleted',
                language === 'ru' ? 'Личные данные и галерея удалены.' : 'Personal data and gallery have been deleted.'
              );
            } catch (error) {
              Alert.alert(
                language === 'ru' ? 'Не удалось удалить аккаунт' : 'Account deletion failed',
                error instanceof Error ? error.message : 'Проверь подключение и повтори попытку.'
              );
            } finally {
              setAuthBusy(false);
            }
          },
        },
      ]
    );
  };

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCredits = async () => {
    if (!authToken) {
      setCreditsBalance(null);
      setCreditHistory([]);
      return;
    }
    setCreditsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/credits`, {
        headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      setCreditsBalance(Number.isFinite(Number(data.balance)) ? Number(data.balance) : 0);
      setCreditHistory(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setCreditsBalance(null);
      Alert.alert(
        language === 'ru' ? 'Не удалось загрузить баланс' : 'Не удалось загрузить баланс',
        error instanceof Error ? error.message : 'Неизвестная ошибка'
      );
    } finally {
      setCreditsLoading(false);
    }
  };

  const loadFaq = async () => {
    setFaqLoading(true);
    setFaqError('');
    try {
      const isAdmin = !!authToken && ['owner', 'admin'].includes(authUser?.role);
      const response = await fetch(API_BASE_URL + (isAdmin ? '/api/admin/faq' : '/api/faq'), {
        headers: authToken ? { Authorization: 'Bearer ' + authToken, Accept: 'application/json' } : { Accept: 'application/json' },
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || 'Не удалось загрузить FAQ');
      setFaqItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setFaqError(error instanceof Error ? error.message : 'Не удалось загрузить FAQ');
    } finally {
      setFaqLoading(false);
    }
  };

  const saveFaqEntry = async (entry: any, faqId?: string): Promise<boolean> => {
    if (!authToken || !['owner', 'admin'].includes(authUser?.role)) return false;
    setFaqLoading(true);
    setFaqError('');
    try {
      const response = await fetch(
        API_BASE_URL + (faqId ? '/api/admin/faq/' + encodeURIComponent(faqId) : '/api/admin/faq'),
        {
          method: faqId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
          body: JSON.stringify(entry),
        }
      );
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || 'Не удалось сохранить FAQ');
      await loadFaq();
      Alert.alert(language === 'ru' ? 'FAQ обновлён' : 'FAQ saved');
      return true;
    } catch (error) {
      setFaqError(error instanceof Error ? error.message : 'Не удалось сохранить FAQ');
      return false;
    } finally {
      setFaqLoading(false);
    }
  };

  const loadSupportTickets = async () => {
    if (!authToken) {
      setSupportTickets([]);
      setSupportError(language === 'ru' ? 'Войдите, чтобы обратиться в поддержку.' : 'Sign in to contact support.');
      return;
    }
    setSupportLoading(true);
    setSupportError('');
    try {
      const staffMode = ['owner', 'admin', 'support'].includes(authUser?.role);
      const endpoint = staffMode
        ? `${API_BASE_URL}/api/support/staff/tickets?status=${supportFilter}`
        : `${API_BASE_URL}/api/support/tickets`;
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      setSupportTickets(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : 'Не удалось загрузить обращения');
    } finally {
      setSupportLoading(false);
    }
  };

  const openSupportTicket = async (ticketId: string) => {
    if (!authToken) return;
    setSupportBusy(true);
    setSupportError('');
    try {
      const staffMode = ['owner', 'admin', 'support'].includes(authUser?.role);
      const route = staffMode ? 'staff/tickets/' : 'tickets/';
      const response = await fetch(`${API_BASE_URL}/api/support/${route}${encodeURIComponent(ticketId)}`, {
        headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      setSupportFiles([]);
      setSelectedSupportTicket(data);
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : 'Не удалось открыть обращение');
    } finally {
      setSupportBusy(false);
    }
  };

  const createSupportTicket = async () => {
    if (!authToken) {
      setSupportError(language === 'ru' ? 'Сначала войдите в аккаунт.' : 'Sign in first.');
      return;
    }
    if (supportDescription.trim().length < 5) {
      setSupportError(language === 'ru' ? 'Опишите проблему подробнее.' : 'Please describe the issue in more detail.');
      return;
    }
    setSupportBusy(true);
    setSupportError('');
    try {
      const response = await fetch(`${API_BASE_URL}/api/support/tickets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
        body: JSON.stringify({ category: supportCategory, description: supportDescription.trim() }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      setSupportDescription('');
      setSelectedSupportTicket(data);
      let createdTicket = data;
      if (supportFiles.length > 0) {
        const form = new FormData();
        form.append('message', '');
        supportFiles.forEach((asset, index) => {
          const name = (asset.fileName || asset.uri).toLowerCase();
          const extension = asset.mimeType === 'image/png' || name.endsWith('.png') ? 'png' : 'jpg';
          const file = new ExpoFile(asset.uri);
          form.append('files', file, asset.fileName || `support-attachment-${index + 1}.${extension}`);
        });
        const attachmentResponse = await fetch(`${API_BASE_URL}/api/support/tickets/${encodeURIComponent(data.ticket_id)}/messages/attachments`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
          body: form,
        });
        const attachmentData = await readResponse(attachmentResponse);
        if (!attachmentResponse.ok) throw new Error(attachmentData.detail || `HTTP ${attachmentResponse.status}`);
        createdTicket = attachmentData;
      }
      setSupportFiles([]);
      setSelectedSupportTicket(createdTicket);
      await loadSupportTickets();
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : 'Не удалось создать обращение');
    } finally {
      setSupportBusy(false);
    }
  };

  const closeSupportTicket = async () => {
    if (!authToken || !selectedSupportTicket) return;
    setSupportBusy(true);
    setSupportError('');
    try {
      const response = await fetch(
        API_BASE_URL + '/api/support/staff/tickets/' + encodeURIComponent(selectedSupportTicket.ticket_id) + '/status',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
          body: JSON.stringify({ status: 'closed' }),
        }
      );
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || 'HTTP ' + response.status);
      setSelectedSupportTicket(data);
      await loadSupportTickets();
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : 'Не удалось закрыть обращение');
    } finally {
      setSupportBusy(false);
    }
  };

  const chooseSupportFiles = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          language === 'ru' ? 'Нужен доступ к фотографиям' : 'Photo access required',
          language === 'ru' ? 'Разрешите выбрать изображения для обращения.' : 'Allow access to choose support attachments.'
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        allowsMultipleSelection: true,
        selectionLimit: 5,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      const combined = [...supportFiles, ...result.assets];
      if (combined.length > 5) {
        Alert.alert(
          language === 'ru' ? 'Слишком много файлов' : 'Too many files',
          language === 'ru' ? 'К одному сообщению можно прикрепить не более 5 изображений.' : 'You can attach up to 5 images to one message.'
        );
        return;
      }
      for (const asset of result.assets) {
        const name = (asset.fileName || asset.uri).toLowerCase();
        const mime = asset.mimeType || (name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : '');
        if (!['image/jpeg', 'image/png'].includes(mime)) {
          throw new Error(language === 'ru' ? 'Поддерживаются только JPEG и PNG.' : 'Only JPEG and PNG files are supported.');
        }
        if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
          throw new Error(language === 'ru' ? 'Размер каждого изображения — не более 10 МБ.' : 'Each image must be 10 MB or smaller.');
        }
      }
      setSupportFiles(combined);
      setSupportError('');
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : 'Не удалось выбрать вложения');
    }
  };

  const openSupportAttachment = async (attachment: any) => {
    if (!authToken || !attachment?.attachment_id) return;
    let file: ExpoFile | null = null;
    try {
      const response = await expoFetch(
        `${API_BASE_URL}/api/support/attachments/${encodeURIComponent(attachment.attachment_id)}`,
        { headers: { Authorization: `Bearer ${authToken}` } }
      );
      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `HTTP ${response.status}`);
      }
      const safeName = String(attachment.file_name || 'support-image.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
      const extension = safeName.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
      file = new ExpoFile(ExpoPaths.cache, `support-${attachment.attachment_id}-${Date.now()}.${extension}`);
      await file.write(await response.bytes());
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error(language === 'ru' ? 'На устройстве недоступно открытие вложений.' : 'Attachments cannot be opened on this device.');
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: extension === 'png' ? 'image/png' : 'image/jpeg',
        dialogTitle: language === 'ru' ? 'Открыть или сохранить изображение' : 'Open or save image',
      });
    } catch (error) {
      Alert.alert(
        language === 'ru' ? 'Не удалось открыть вложение' : 'Не удалось открыть вложение',
        error instanceof Error ? error.message : 'Неизвестная ошибка'
      );
    } finally {
      try { file?.delete(); } catch { /* temporary attachment cleanup is best-effort */ }
    }
  };

  const sendSupportMessage = async () => {
    if (!authToken || !selectedSupportTicket || !supportMessage.trim()) return;
    setSupportBusy(true);
    setSupportError('');
    try {
      let response: Response;
      const staffMode = ['owner', 'admin', 'support'].includes(authUser?.role);
      const messageRoute = staffMode ? 'staff/tickets/' : 'tickets/';
      const attachmentRoute = staffMode
        ? 'staff/tickets/' + encodeURIComponent(selectedSupportTicket.ticket_id) + '/messages/attachments'
        : 'tickets/' + encodeURIComponent(selectedSupportTicket.ticket_id) + '/messages/attachments';
      const standardRoute = messageRoute + encodeURIComponent(selectedSupportTicket.ticket_id) + '/messages';
      if (supportFiles.length > 0) {
        const form = new FormData();
        form.append('message', supportMessage.trim());
        supportFiles.forEach((asset, index) => {
          const name = (asset.fileName || asset.uri).toLowerCase();
          const extension = asset.mimeType === 'image/png' || name.endsWith('.png') ? 'png' : 'jpg';
          const file = new ExpoFile(asset.uri);
          form.append('files', file, asset.fileName || `support-attachment-${index + 1}.${extension}`);
        });
        response = await fetch(`${API_BASE_URL}/api/support/${attachmentRoute}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
          body: form,
        });
      } else {
        response = await fetch(`${API_BASE_URL}/api/support/${standardRoute}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, Accept: 'application/json' },
          body: JSON.stringify({ message: supportMessage.trim() }),
        });
      }
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || `HTTP ${response.status}`);
      setSelectedSupportTicket(data);
      setSupportMessage('');
      setSupportFiles([]);
      await loadSupportTickets();
    } catch (error) {
      setSupportError(error instanceof Error ? error.message : 'Не удалось отправить сообщение');
    } finally {
      setSupportBusy(false);
    }
  };

  const loadNotifications = async (silent = false) => {
    if (!authToken) {
      setNotifications([]);
      setUnreadNotifications(0);
      return;
    }
    if (notificationRefreshBusyRef.current) return;
    notificationRefreshBusyRef.current = true;
    if (!silent) setNotificationsLoading(true);
    try {
      const response = await fetch(API_BASE_URL + '/api/notifications', {
        headers: { Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || 'HTTP ' + response.status);
      setNotifications(Array.isArray(data.items) ? data.items : []);
      setUnreadNotifications(Number(data.unread_count) || 0);
    } catch (error) {
      if (!silent) {
        Alert.alert(
          language === 'ru' ? 'Не удалось загрузить уведомления' : 'Не удалось загрузить уведомления',
          error instanceof Error ? error.message : 'Неизвестная ошибка'
        );
      }
    } finally {
      notificationRefreshBusyRef.current = false;
      if (!silent) setNotificationsLoading(false);
    }
  };

  notificationRefreshRef.current = () => loadNotifications(true);

  useEffect(() => {
    if (!authToken) {
      setNotifications([]);
      setUnreadNotifications(0);
      return;
    }
    const refreshNotifications = () => {
      void notificationRefreshRef.current?.();
    };
    refreshNotifications();
    const timer = setInterval(refreshNotifications, 30000);
    return () => clearInterval(timer);
  }, [authToken]);

  const markNotificationRead = async (notificationId: string) => {
    if (!authToken) return;
    try {
      const response = await fetch(API_BASE_URL + '/api/notifications/' + encodeURIComponent(notificationId) + '/read', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + authToken },
      });
      if (!response.ok) return;
      const wasUnread = notifications.some((item) => item.notification_id === notificationId && !item.read_at);
      setNotifications((current) => current.map((item) => item.notification_id === notificationId ? { ...item, read_at: new Date().toISOString() } : item));
      if (wasUnread) setUnreadNotifications((count) => Math.max(0, count - 1));
    } catch {
      // Keep the notification unread locally if the server could not confirm the update.
    }
  };

  const markAllNotificationsRead = async () => {
    if (!authToken) return;
    try {
      const response = await fetch(API_BASE_URL + '/api/notifications/read-all', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + authToken },
      });
      if (!response.ok) return;
      const now = new Date().toISOString();
      setNotifications((current) => current.map((item) => ({ ...item, read_at: item.read_at || now })));
      setUnreadNotifications(0);
    } catch {
      // Leave the unread state unchanged if the server did not confirm.
    }
  };

  const loadAdminPanel = async () => {
    if (!authToken || !['owner', 'admin'].includes(authUser?.role)) return;
    setAdminLoading(true);
    setAdminError('');
    try {
      const headers = { Authorization: 'Bearer ' + authToken, Accept: 'application/json' };
      const [usersResponse, auditResponse, generationsResponse, workersResponse, analyticsResponse] = await Promise.all([
        fetch(API_BASE_URL + '/api/admin/users?limit=100&offset=0', { headers }),
        fetch(API_BASE_URL + '/api/admin/audit?limit=100', { headers }),
        fetch(API_BASE_URL + '/api/admin/generations?limit=100&offset=0', { headers }),
        fetch(API_BASE_URL + '/api/admin/workers', { headers }),
        fetch(API_BASE_URL + '/api/admin/analytics', { headers }),
      ]);
      const usersData = await readResponse(usersResponse);
      const auditData = await readResponse(auditResponse);
      const generationsData = await readResponse(generationsResponse);
      const workersData = await readResponse(workersResponse);
      const analyticsData = await readResponse(analyticsResponse);
      if (!usersResponse.ok) throw new Error(usersData.detail || 'Не удалось загрузить пользователей');
      if (!auditResponse.ok) throw new Error(auditData.detail || 'Не удалось загрузить журнал действий');
      if (!generationsResponse.ok) throw new Error(generationsData.detail || 'Не удалось загрузить очередь генераций');
      if (!workersResponse.ok) throw new Error(workersData.detail || 'Не удалось загрузить GPU-мониторинг');
      if (!analyticsResponse.ok) throw new Error(analyticsData.detail || 'Не удалось загрузить аналитику');
      setAdminUsers(Array.isArray(usersData.items) ? usersData.items : []);
      setAdminAudit(Array.isArray(auditData.items) ? auditData.items : []);
      setAdminGenerations(Array.isArray(generationsData.items) ? generationsData.items : []);
      setAdminWorkers(Array.isArray(workersData.items) ? workersData.items : []);
      setAdminAnalytics(analyticsData);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : 'Не удалось загрузить панель управления');
    } finally {
      setAdminLoading(false);
    }
  };

  const setAdminGenerationPriority = async (jobId: string, priority: number) => {
    if (!authToken || !Number.isInteger(priority) || priority < -100 || priority > 100) return;
    setAdminLoading(true);
    try {
      const response = await fetch(API_BASE_URL + '/api/admin/generations/' + encodeURIComponent(jobId) + '/priority', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
        body: JSON.stringify({ priority }),
      });
      const data = await readResponse(response);
      if (!response.ok) throw new Error(data.detail || 'Не удалось изменить приоритет');
      await loadAdminPanel();
    } catch (error) {
      Alert.alert(language === 'ru' ? 'Ошибка очереди' : 'Ошибка очереди', error instanceof Error ? error.message : 'Запрос не выполнен');
    } finally {
      setAdminLoading(false);
    }
  };

  const cancelAdminGeneration = (jobId: string) => {
    Alert.alert(
      language === 'ru' ? 'Отменить задание?' : 'Cancel generation?',
      language === 'ru'
        ? 'Отменить можно только задание, которое ещё не передано GPU-воркеру.'
        : 'Only a job not yet leased to a GPU worker can be cancelled.',
      [
        { text: language === 'ru' ? 'Назад' : 'Back', style: 'cancel' },
        {
          text: language === 'ru' ? 'Отменить' : 'Cancel',
          style: 'destructive',
          onPress: async () => {
            setAdminLoading(true);
            try {
              const response = await fetch(API_BASE_URL + '/api/admin/generations/' + encodeURIComponent(jobId) + '/cancel', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
              });
              const data = await readResponse(response);
              if (!response.ok) throw new Error(data.detail || 'Не удалось отменить задание');
              await loadAdminPanel();
            } catch (error) {
              Alert.alert(language === 'ru' ? 'Ошибка очереди' : 'Ошибка очереди', error instanceof Error ? error.message : 'Запрос не выполнен');
            } finally {
              setAdminLoading(false);
            }
          },
        },
      ]
    );
  };

  const retryAdminGeneration = (jobId: string) => {
    Alert.alert(
      language === 'ru' ? 'Повторить генерацию?' : 'Retry generation?',
      language === 'ru'
        ? 'Повторно запускаются только ошибки T2V. Для I2V потребуется новое изображение.'
        : 'Only failed T2V jobs can be retried. I2V requires a new source image.',
      [
        { text: language === 'ru' ? 'Назад' : 'Back', style: 'cancel' },
        {
          text: language === 'ru' ? 'Повторить' : 'Retry',
          onPress: async () => {
            setAdminLoading(true);
            try {
              const response = await fetch(API_BASE_URL + '/api/admin/generations/' + encodeURIComponent(jobId) + '/retry', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
              });
              const data = await readResponse(response);
              if (!response.ok) throw new Error(data.detail || 'Не удалось повторить генерацию');
              await loadAdminPanel();
            } catch (error) {
              Alert.alert(language === 'ru' ? 'Ошибка очереди' : 'Ошибка очереди', error instanceof Error ? error.message : 'Запрос не выполнен');
            } finally {
              setAdminLoading(false);
            }
          },
        },
      ]
    );
  };

  const adjustUserCredits = (targetUserId: string, amount: number, reason: string) => {
    Alert.alert(
      language === 'ru' ? 'Подтвердить изменение баланса?' : 'Confirm credit adjustment?',
      language === 'ru'
        ? 'Операция будет записана в неизменяемый журнал аудита.'
        : 'This operation will be written to the immutable audit log.',
      [
        { text: language === 'ru' ? 'Отмена' : 'Cancel', style: 'cancel' },
        {
          text: language === 'ru' ? 'Подтвердить' : 'Confirm',
          onPress: async () => {
            setAdminLoading(true);
            try {
              const response = await fetch(API_BASE_URL + '/api/admin/users/' + encodeURIComponent(targetUserId) + '/credits', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
                body: JSON.stringify({
                  amount,
                  reason: reason.trim(),
                  request_id: 'admin-credit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
                }),
              });
              const data = await readResponse(response);
              if (!response.ok) throw new Error(data.detail || 'Не удалось изменить баланс');
              Alert.alert(language === 'ru' ? 'Баланс обновлён' : 'Баланс обновлён', (language === 'ru' ? 'Новый баланс: ' : 'New balance: ') + data.balance);
              await loadAdminPanel();
            } catch (error) {
              Alert.alert(language === 'ru' ? 'Ошибка' : 'Ошибка', error instanceof Error ? error.message : 'Запрос не выполнен');
            } finally {
              setAdminLoading(false);
            }
          },
        },
      ]
    );
  };

  const changeUserRole = (targetUserId: string, role: 'user' | 'admin' | 'support', reason: string) => {
    Alert.alert(
      language === 'ru' ? 'Изменить роль пользователя?' : 'Change user role?',
      language === 'ru' ? 'Действие будет записано в журнал аудита.' : 'This action will be recorded in the audit log.',
      [
        { text: language === 'ru' ? 'Отмена' : 'Cancel', style: 'cancel' },
        {
          text: language === 'ru' ? 'Подтвердить' : 'Confirm',
          onPress: async () => {
            setAdminLoading(true);
            try {
              const response = await fetch(API_BASE_URL + '/api/admin/users/' + encodeURIComponent(targetUserId) + '/role', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken, Accept: 'application/json' },
                body: JSON.stringify({
                  role,
                  reason: reason.trim(),
                  request_id: 'admin-role-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
                }),
              });
              const data = await readResponse(response);
              if (!response.ok) throw new Error(data.detail || 'Не удалось изменить роль');
              await loadAdminPanel();
            } catch (error) {
              Alert.alert(language === 'ru' ? 'Ошибка' : 'Ошибка', error instanceof Error ? error.message : 'Запрос не выполнен');
            } finally {
              setAdminLoading(false);
            }
          },
        },
      ]
    );
  };

  const loadGallery = async () => {
    setGalleryLoading(true);
    setGalleryError('');

    try {
      if (!authToken) { setGalleryItems([]); return; }
      const response = await fetch(`${API_BASE_URL}/api/generations?limit=50&offset=0`, { headers: { Authorization: `Bearer ${authToken}` } });
      const data = await readResponse(response);
      if (!response.ok) {
        throw new Error(data.detail || `HTTP ${response.status}`);
      }
      const items = Array.isArray(data.items) ? data.items : [];
      setGalleryItems(
        items
          .filter((item: any) =>
            ['completed', 'complete', 'success', 'succeeded', 'done'].includes(
              String(item.status || '').toLowerCase()
            ) && readVideoUrl(item)
          )
          .slice(0, 2)
      );
    } catch (error) {
      setGalleryError(
        error instanceof Error ? error.message : language === 'ru' ? 'Не удалось загрузить галерею' : 'Не удалось загрузить галерею'
      );
    } finally {
      setGalleryLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'Gallery' || jobStatus === 'completed') {
      loadGallery();
    }
  }, [tab, jobStatus, authToken]);

  useEffect(() => {
    if (showSupport && authToken && ['owner', 'admin', 'support'].includes(authUser?.role)) {
      void loadSupportTickets();
    }
  }, [showSupport, supportFilter, authToken, authUser?.role]);

  useEffect(() => {
    if (authToken) void loadCredits();
    else {
      setCreditsBalance(null);
      setCreditHistory([]);
    }
  }, [authToken]);

  useEffect(() => {
    if (!jobId || jobStatus === 'completed' || jobStatus === 'failed') {
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/generations/${encodeURIComponent(jobId)}`,
          { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }
        );

        const data = await readResponse(response);

        if (!response.ok) {
          throw new Error(
            data.detail || data.message || `HTTP ${response.status}`
          );
        }

        if (cancelled) return;

        const status = readJobStatus(data);
        const url = readVideoUrl(data);

        setPollError('');

        if (url) setVideoUrl(url);

        if (
          ['completed', 'complete', 'success', 'succeeded', 'done'].includes(status)
        ) {
          setJobStatus('completed');
          setPrompt('');
          setSourceImage(null);
          setJobMessage(language === 'ru' ? 'Видео успешно создано.' : 'Video created successfully.');
          return;
        }

        if (
          ['failed', 'error', 'cancelled', 'canceled'].includes(status)
        ) {
          setJobStatus('failed');
          setJobMessage(
            language === 'ru' ? (data.error || data.detail || 'Генерация завершилась с ошибкой.') : 'Generation failed. Please try again.'
          );
          return;
        }

        if (status === 'uploading') {
          setJobStatus('uploading');
          setJobMessage(language === 'ru' ? 'Сохраняем готовое видео.' : 'Saving the completed video.');
        } else if (status === 'starting') {
          setJobStatus('starting');
          setJobMessage(language === 'ru' ? 'Подготавливаем генерацию.' : 'Preparing generation.');
        } else if (
          ['generating', 'running', 'in_progress'].includes(status)
        ) {
          setJobStatus('generating');
          setJobMessage(language === 'ru' ? 'НейроСцена создаёт видео. Это может занять некоторое время.' : 'NeuroScene is generating your video. This may take a while.');
        } else {
          setJobStatus('queued');
          setJobMessage(language === 'ru' ? 'Задача находится в очереди.' : 'Your task is queued.');
        }
      } catch (error) {
        if (!cancelled) {
          setPollError(
            error instanceof Error ? error.message : (language === 'ru' ? 'Ошибка получения статуса' : 'Не удалось получить статус генерации')
          );
        }
      }

      if (!cancelled) {
        pollTimer.current = setTimeout(poll, 3000);
      }
    };

    pollTimer.current = setTimeout(poll, 1500);

    return () => {
      cancelled = true;

      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
      }
    };
  }, [jobId, jobStatus, language, authToken]);

  const handleChooseImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          language === 'ru' ? 'Нужен доступ к фотографиям' : 'Photo access required',
          language === 'ru' ? 'Разреши приложению выбрать исходное изображение.' : 'Allow access so the app can select a source image.'
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.95,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = (asset.fileName || asset.uri).toLowerCase();
      const mime = asset.mimeType || (fileName.endsWith('.png') ? 'image/png' : 'image/jpeg');
      if (!['image/jpeg', 'image/png'].includes(mime)) {
        Alert.alert(
          language === 'ru' ? 'Неподдерживаемый формат' : 'Unsupported format',
          language === 'ru' ? 'Выбери изображение JPEG или PNG.' : 'Choose a JPEG or PNG image.'
        );
        return;
      }
      if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) {
        Alert.alert(
          language === 'ru' ? 'Файл слишком большой' : 'File is too large',
          language === 'ru' ? 'Максимальный размер изображения — 10 МБ.' : 'Maximum image size is 10 MB.'
        );
        return;
      }
      setSourceImage({ ...asset, mimeType: mime });
    } catch (error) {
      Alert.alert(
        language === 'ru' ? 'Не удалось выбрать изображение' : 'Не удалось выбрать изображение',
        error instanceof Error ? error.message : 'Неизвестная ошибка'
      );
    }
  };


  const handleEnhancePrompt = async () => {
    if (!authToken || !authUser) {
      Alert.alert(language === 'ru' ? 'Нужен аккаунт' : 'Account required', language === 'ru' ? 'Войди, чтобы улучшить промпт.' : 'Sign in to enhance your prompt.');
      setTab('Profile');
      return;
    }
    const sourcePrompt = prompt.trim();
    if (sourcePrompt.length < 10 || sourcePrompt.length > 2000) {
      Alert.alert(language === 'ru' ? 'Проверь описание сцены' : 'Check your prompt', language === 'ru' ? 'Для улучшения нужно от 10 до 2000 символов.' : 'Prompt must contain 10 to 2000 characters.');
      return;
    }
    if (promptEnhancing || submitting || ['queued', 'starting', 'generating', 'uploading'].includes(jobStatus)) return;
    setPromptEnhancing(true);
    setEnhancedPrompt('');
    try {
      const startResponse = await fetch(`${API_BASE_URL}/api/prompts/enhance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ prompt: sourcePrompt }),
      });
      const startData = await readResponse(startResponse);
      if (!startResponse.ok) throw new Error(startData.detail || 'Не удалось отправить промпт на улучшение');
      if (typeof startData.task_id !== 'string') throw new Error('Backend не вернул идентификатор задачи улучшения');
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const statusResponse = await fetch(`${API_BASE_URL}/api/prompts/enhance/${encodeURIComponent(startData.task_id)}`, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${authToken}` },
        });
        const statusData = await readResponse(statusResponse);
        if (!statusResponse.ok) throw new Error(statusData.detail || 'Не удалось получить результат улучшения');
        if (statusData.status === 'completed' && typeof statusData.result === 'string') {
          setEnhancedPrompt(statusData.result);
          return;
        }
        if (statusData.status === 'failed') {
          throw new Error(statusData.error || 'Gemma 4 E2B не смогла улучшить промпт');
        }
      }
      throw new Error(language === 'ru' ? 'Истекло время ожидания Gemma 4 E2B.' : 'Timed out waiting for Gemma 4 E2B.');
    } catch (error) {
      Alert.alert(
        language === 'ru' ? 'Не удалось улучшить промпт' : 'Prompt enhancement failed',
        error instanceof Error ? error.message : 'Неизвестная ошибка'
      );
    } finally {
      setPromptEnhancing(false);
    }
  };

  const handleCreate = async () => {
    if (!authToken || !authUser) {
      Alert.alert(language === 'ru' ? 'Нужен аккаунт' : 'Account required', language === 'ru' ? 'Войди или зарегистрируйся, чтобы создавать видео.' : 'Sign in or create an account to generate videos.');
      setTab('Profile');
      return;
    }
    const cleanPrompt = prompt.trim();

    if (cleanPrompt.length < 10) {
      Alert.alert(
        language === 'ru' ? 'Промпт слишком короткий' : 'Prompt is too short',
        language === 'ru' ? 'Опиши сцену на английском языке. Минимум 10 символов.' : 'Describe the scene in English. At least 10 characters.'
      );
      return;
    }

    if (cleanPrompt.length > 2000) {
      Alert.alert(
        language === 'ru' ? 'Слишком длинный промпт' : 'Prompt is too long',
        language === 'ru' ? 'Максимум 2000 символов.' : 'Maximum 2000 characters.'
      );
      return;
    }

    if (generationType === 'i2v' && !sourceImage) {
      Alert.alert(
        language === 'ru' ? 'Добавь исходное изображение' : 'Add a source image',
        language === 'ru' ? 'Для режима «Изображение в видео» нужно выбрать JPEG или PNG.' : 'Select a JPEG or PNG image for Image to Video.'
      );
      return;
    }

    if (['queued', 'starting', 'generating', 'uploading'].includes(jobStatus) || submitting) {
      Alert.alert(
        language === 'ru' ? 'Генерация уже выполняется' : 'Generation is already running',
        language === 'ru' ? 'Дождись завершения текущей задачи.' : 'Wait for the current task to finish.'
      );
      return;
    }

    setSubmitting(true);
    setJobId(null);
    setJobStatus('idle');
    setVideoUrl(null);
    setJobMessage('');
    setPollError('');

    try {
      let response: Response;
      if (generationType === 'i2v' && sourceImage) {
        const form = new FormData();
        form.append('prompt', cleanPrompt);
        form.append('duration', String(duration));
        form.append('aspect_ratio', ratio);
        form.append('model', 'kandinsky-6');
        form.append('audio_enabled', 'true');
        form.append('audio_profile', 'prompt-driven');
        const extension = sourceImage.mimeType === 'image/png' ? 'png' : 'jpg';
        const imageFile = new ExpoFile(sourceImage.uri);
        form.append(
          'image',
          imageFile,
          sourceImage.fileName || `neuroscene-source.${extension}`
        );
        response = await fetch(`${API_BASE_URL}/api/generations/i2v`, {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${authToken}` },
          body: form,
        });
      } else {
        response = await fetch(`${API_BASE_URL}/api/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            prompt: cleanPrompt,
            model: 'kandinsky-6',
            generation_type: 't2v',
            duration,
            aspect_ratio: ratio,
            audio_enabled: true,
            audio_profile: 'prompt-driven',
          }),
        });
      }

      const data = await readResponse(response);

      if (!response.ok) {
        throw new Error(
          data.detail || data.message || `Backend вернул HTTP ${response.status}`
        );
      }

      const newJobId = readJobId(data);

      if (!newJobId) {
        throw new Error(
          'Backend ответил, но в ответе не найден job_id. Ответ: ' +
          JSON.stringify(data)
        );
      }

      setJobId(newJobId);
      setJobStatus('queued');
      setJobMessage(language === 'ru' ? 'Задача отправлена в очередь.' : 'Your task has been added to the queue.');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Неизвестная ошибка';

      Alert.alert(
        language === 'ru' ? 'Не удалось запустить генерацию' : 'Не удалось запустить генерацию',
        language === 'ru' ? `${message}\n\nПроверь подключение телефона к локальной сети.` : `${message}\n\nCheck the phone connection to the local network.`
      );
    } finally {
      setSubmitting(false);
    }
  };

  const resetGeneration = () => {
    setJobId(null);
    setJobStatus('idle');
    setJobMessage('');
    setVideoUrl(null);
    setPollError('');
  };

  const openVideo = () => {
    if (!videoUrl) return;
    setTab('Gallery');
  };

  const regenerateFromGallery = (item: any) => {
    setPrompt(String(item?.prompt || ''));
    setGenerationType(item?.generation_type === 'i2v' ? 'i2v' : 't2v');
    setSourceImage(null);
    setTab('Create');
    if (item?.generation_type === 'i2v') {
      Alert.alert(
        language === 'ru' ? 'Добавь исходное изображение' : 'Add the source image',
        language === 'ru'
          ? 'Исходное изображение удаляется после обработки. Выбери его заново, чтобы повторить эту I2V-генерацию.'
          : 'The source image is deleted after processing. Select it again to repeat this Image to Video generation.'
      );
    }
  };

  const copyGalleryPrompt = async (value: string) => {
    try {
      await Clipboard.setStringAsync(value);
      Alert.alert(language === 'ru' ? 'Скопировано' : 'Copied', language === 'ru' ? 'Исходный промпт скопирован.' : 'Original prompt copied.');
    } catch (error) {
      Alert.alert(language === 'ru' ? 'Не удалось скопировать' : 'Не удалось скопировать', error instanceof Error ? error.message : 'Буфер обмена недоступен');
    }
  };

  const exportGalleryVideo = async (url: string, jobId: string) => {
    let downloaded: ExpoFile | null = null;
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error(language === 'ru' ? 'На этом устройстве недоступно меню отправки файлов.' : 'File sharing is not available on this device.');
      }
      const destination = new ExpoFile(ExpoPaths.cache, `neuroscene-${jobId}-${Date.now()}.mp4`);
      downloaded = await ExpoFile.downloadFileAsync(url, destination);
      await Sharing.shareAsync(downloaded.uri, {
        mimeType: 'video/mp4',
        dialogTitle: language === 'ru' ? 'Сохранить или отправить видео' : 'Save or share video',
        UTI: 'public.mpeg-4',
      });
    } catch (error) {
      Alert.alert(
        language === 'ru' ? 'Не удалось экспортировать видео' : 'Не удалось экспортировать видео',
        error instanceof Error ? error.message : (language === 'ru' ? 'Неизвестная ошибка' : 'Неизвестная ошибка')
      );
    } finally {
      try { downloaded?.delete(); } catch { /* temporary export cleanup is best-effort */ }
    }
  };

  const showTab = () => {
    if (showAdminPanel && !showFaq) {
      return (
        <AdminScreen
          language={language}
          users={adminUsers}
          audit={adminAudit}
          generations={adminGenerations}
          workers={adminWorkers}
          analytics={adminAnalytics}
          loading={adminLoading}
          onSetPriority={setAdminGenerationPriority}
          onCancelGeneration={cancelAdminGeneration}
          onRetryGeneration={retryAdminGeneration}
          error={adminError}
          isOwner={authUser?.role === 'owner'}
          onBack={() => setShowAdminPanel(false)}
          onRefresh={loadAdminPanel}
          onAdjust={adjustUserCredits}
          onChangeRole={changeUserRole}
          onOpenFaq={() => { setShowFaq(true); void loadFaq(); }}
        />
      );
    }
    if (showNotifications) {
      return (
        <NotificationScreen
          language={language}
          items={notifications}
          unreadCount={unreadNotifications}
          loading={notificationsLoading}
          onBack={() => setShowNotifications(false)}
          onRefresh={loadNotifications}
          onRead={markNotificationRead}
          onReadAll={markAllNotificationsRead}
        />
      );
    }
    if (showFaq) {
      return (
        <FAQScreen
          language={language}
          items={faqItems}
          loading={faqLoading}
          error={faqError}
          isAdmin={!!authToken && ['owner', 'admin'].includes(authUser?.role)}
          onBack={() => setShowFaq(false)}
          onRefresh={loadFaq}
          onSave={saveFaqEntry}
        />
      );
    }
    if (showSupport) {
      return (
        <SupportScreen
          language={language}
          authenticated={!!authToken}
          staffRole={authUser?.role || 'user'}
          filter={supportFilter}
          setFilter={setSupportFilter}
          onCloseTicket={closeSupportTicket}
          tickets={supportTickets}
          selectedTicket={selectedSupportTicket}
          loading={supportLoading}
          busy={supportBusy}
          error={supportError}
          category={supportCategory}
          setCategory={setSupportCategory}
          description={supportDescription}
          setDescription={setSupportDescription}
          message={supportMessage}
          setMessage={setSupportMessage}
          files={supportFiles}
          onChooseFiles={chooseSupportFiles}
          onRemoveFile={(index) => setSupportFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
          onBack={() => { setShowSupport(false); setSelectedSupportTicket(null); setSupportFiles([]); }}
          onBackToList={() => { setSelectedSupportTicket(null); setSupportFiles([]); void loadSupportTickets(); }}
          onSignIn={() => { setShowSupport(false); setTab('Profile'); }}
          onRefresh={loadSupportTickets}
          onCreate={createSupportTicket}
          onOpen={openSupportTicket}
          onOpenAttachment={openSupportAttachment}
          onSend={sendSupportMessage}
        />
      );
    }
    if (tab === 'Create') {
      return (
        <CreateScreen
          language={language}
          creditsBalance={creditsBalance}
          creditsLoading={creditsLoading}
          generationType={generationType}
          setGenerationType={setGenerationType}
          sourceImage={sourceImage}
          onChooseImage={handleChooseImage}
          onRemoveImage={() => setSourceImage(null)}
          duration={duration}
          setDuration={setDuration}
          ratio={ratio}
          setRatio={setRatio}
          prompt={prompt}
          setPrompt={(value) => { setPrompt(value); setEnhancedPrompt(''); }}
          enhancedPrompt={enhancedPrompt}
          setEnhancedPrompt={setEnhancedPrompt}
          promptEnhancing={promptEnhancing}
          onEnhancePrompt={handleEnhancePrompt}
          onCreate={handleCreate}
          submitting={submitting}
          jobStatus={jobStatus}
          jobId={jobId}
          jobMessage={jobMessage}
          pollError={pollError}
          videoUrl={videoUrl}
          onOpenVideo={openVideo}
          onReset={resetGeneration}
        />
      );
    }

    if (tab === 'Gallery') {
      return (
        <GalleryScreen
          items={galleryItems}
          language={language}
          loading={galleryLoading}
          error={galleryError}
          onRefresh={loadGallery}
          onCopyPrompt={copyGalleryPrompt}
          onRegenerate={regenerateFromGallery}
          onExport={exportGalleryVideo}
          onDelete={async (jobId: string) => {
            try {
              const response = await fetch(
                `${API_BASE_URL}/api/generations/${encodeURIComponent(jobId)}`,
                { method: 'DELETE', headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }
              );
              const data = await readResponse(response);
              if (!response.ok) {
                throw new Error(data.detail || `HTTP ${response.status}`);
              }
              await loadGallery();
            } catch (error) {
              Alert.alert(
                language === 'ru' ? 'Не удалось удалить видео' : 'Не удалось удалить видео',
                error instanceof Error ? error.message : (language === 'ru' ? 'Неизвестная ошибка' : 'Неизвестная ошибка')
              );
            }
          }}
          onCreate={() => setTab('Create')}
        />
      );
    }

    if (tab === 'Credits') {
      return (
        <View style={[styles.screen, styles.creditsScreen]}>
          <View style={styles.creditsHeader}>
            <Text style={styles.creditsTitle}>{uiText(language, 'Credits', 'Кредиты')}</Text><View style={styles.creditsTitleGlow} />
          </View>
          <View style={styles.creditIllustration}>
            <View pointerEvents="none" style={styles.creditIllustrationGlow} />
            <View style={styles.creditCoinReferenceCrop}>
              <Image
                source={require('./НейроСцена_ синяя галактика творчества-3.png')}
                resizeMode="stretch"
                style={{
                  position: 'absolute',
                  width: 1536 * (112 / 105),
                  height: 1024 * (112 / 105),
                  left: -1035 * (112 / 105),
                  top: -276 * (112 / 105),
                }}
              />
            </View>
            <View style={[styles.creditCoinStack, { display: 'none' }]} />
            <View style={[styles.creditStarBadge, { display: 'none' }]} />
            <View style={styles.creditBalanceHero}>
              <Text style={styles.creditBalanceEyebrow}>ВАШ БАЛАНС</Text>
              <Text style={styles.creditBalanceHeroValue}>{creditsLoading ? '…' : creditsBalance === null ? '—' : creditsBalance.toLocaleString('ru-RU')}</Text>
              <Text style={styles.creditBalanceHeroLabel}>кредитов</Text>
            </View>
          </View>
          <Text style={styles.creditPackagesTitle}>Пакеты кредитов</Text>
          {[500, 1500, 5000].map((amount) => (
            <View style={[styles.packageCard, amount === 1500 && styles.packageCardPopular]} key={amount}>
              <View style={styles.packageIconWrap}>
                <Text style={[styles.packageIcon, amount === 5000 && styles.packageDiamond]}>{amount === 500 ? '★' : amount === 1500 ? '♛' : '◆'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.packageAmount}>{amount.toLocaleString('ru-RU')}</Text>
                <Text style={styles.packagePrice}>{amount === 500 ? '₽99' : amount === 1500 ? '₽249' : '₽749'}</Text>
              </View>
              <View style={styles.packageRight}>
                {amount === 1500 && <View style={styles.popularBadge}><Text style={styles.popularBadgeText}>Популярно</Text></View>}
                <Text style={styles.packageIncluded}>Без подписки</Text>
              </View>
            </View>
          ))}
          <View style={[styles.creditHistorySection, { display: 'none' } ]}>
            <View style={styles.creditHistoryHeader}>
              <Text style={styles.sectionTitle}>{uiText(language, 'CREDIT ACTIVITY', 'ИСТОРИЯ ОПЕРАЦИЙ')}</Text>
              <Text style={styles.creditHistoryCount}>{creditHistory.length}</Text>
            </View>
            {creditsLoading ? (
              <View style={styles.creditHistoryEmpty}><ActivityIndicator color={BLUE} /><Text style={styles.mutedText}>Загружаем историю операций…</Text></View>
            ) : creditHistory.length > 0 ? (
              creditHistory.map((entry) => (
                <View key={entry.entry_id} style={styles.creditHistoryRow}>
                  <View style={styles.creditHistoryIcon}><Text style={styles.creditHistoryIconText}>✦</Text></View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.packageAmount} numberOfLines={2}>{entry.reason}</Text>
                    <Text style={styles.mutedText}>{entry.created_at ? new Date(entry.created_at).toLocaleString('ru-RU') : ''}</Text>
                  </View>
                  <Text style={[styles.creditHistoryAmount, { color: entry.amount > 0 ? '#65E6B0' : '#FF9AA4' }]}>
                    {entry.amount > 0 ? '+' : ''}{entry.amount} ✦
                  </Text>
                </View>
              ))
            ) : (
              <View style={styles.creditHistoryEmpty}>
                <Text style={styles.creditHistoryEmptyIcon}>◷</Text>
                <Text style={styles.creditHistoryEmptyTitle}>Операций пока нет</Text>
                <Text style={styles.mutedText}>Здесь будут отображаться начисления и списания кредитов</Text>
              </View>
            )}
          </View>
          <Text style={styles.creditNeverExpire}>∞  Кредиты не сгорают</Text>
          <TouchableOpacity activeOpacity={0.65} style={styles.buyCreditsButton} disabled>
            <Text style={styles.buyCreditsButtonText}>Купить кредиты</Text>
            <Text style={styles.buyCreditsHint}>Без подписки · Кредиты не сгорают</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.screen}>
        <View style={styles.profileHeader}>
          <Text style={styles.screenTitle}>{uiText(language, 'Profile', 'Профиль')}</Text>
          {authUser && <TouchableOpacity style={styles.profileSettingsButton} onPress={() => Alert.alert('Настройки', 'Настройки профиля')}>
            <Text style={styles.profileSettingsIcon}>⚙</Text>
          </TouchableOpacity>}
        </View>
        <View style={styles.profileIdentity}>
          <View style={styles.profileGuestAvatar}>
            <View style={styles.profileAvatarHalo} />
            <View style={styles.profileGuestHead} />
            <View style={styles.profileGuestBody} />
          </View>
          <Text style={styles.profileGuestName}>{authUser?.name || authUser?.email?.split('@')[0] || 'Гость'}</Text>
          <Text style={styles.profileGuestStatus}>{authUser?.email || 'Войдите, чтобы открыть все возможности'}</Text>
        </View>
        {authUser ? (
          <>
            <View style={[styles.profileCard, { display: 'none' }]}>
              <View style={styles.avatar}><Text style={styles.avatarText}>Н+С</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.profileName}>{uiText(language, 'YOUR ACCOUNT', 'ВАШ АККАУНТ')}</Text>
                <Text style={styles.mutedText}>{authUser.email}</Text>
              </View>
            </View>
            <TouchableOpacity activeOpacity={0.86} style={styles.authSecondary} onPress={logoutAllDevices} disabled={authBusy}>
              <Text style={styles.authSecondaryText}>{uiText(language, 'Sign out all devices', 'Выйти со всех устройств')}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.86} style={styles.authSecondary} onPress={deleteAccount} disabled={authBusy}>
              <Text style={[styles.authSecondaryText, { color: '#FF7777' }]}>{uiText(language, 'Delete account and personal data', 'Удалить аккаунт и личные данные')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
          <View style={styles.loginScreen}>
            <Text style={styles.loginTagline}>Войдите, чтобы сохранять свои видео и получать больше возможностей</Text>
          <TouchableOpacity activeOpacity={0.86} style={styles.profileVkButton} onPress={handleVkLogin} disabled={authBusy}>
            <Text style={styles.profileVkMark}>ᴠκ</Text>
            <Text style={styles.profileVkText}>Войти через VK ID</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.86} style={styles.profileEmailButton} onPress={() => setProfileEmailOpen((value) => !value)}>
            <Text style={styles.profileEmailButtonText}>{profileEmailOpen ? 'Скрыть вход по email' : 'Войти по email'}</Text>
          </TouchableOpacity>
          <View style={styles.profilePrivacyCard}><Text style={styles.profilePrivacyIcon}>◇</Text><View style={{ flex: 1 }}><Text style={styles.profilePrivacyTitle}>Ваши данные в безопасности</Text><Text style={styles.profilePrivacyText}>Мы не передаём их третьим лицам</Text></View></View>
          <Text style={styles.loginLegalText}>Продолжая, вы принимаете условия использования и политику конфиденциальности.</Text>
          </View>
          {profileEmailOpen && <View style={styles.authCard}>
            <View style={styles.authBrandMark}><Text style={styles.authBrandMarkText}>Н+С</Text></View>
            <Text style={styles.authBrandTitle}>Нейро{ '\n' }Сцена</Text>
            <Text style={styles.sectionTitle}>{uiText(language, 'SIGN IN OR REGISTER', 'ВХОД ПО EMAIL')}</Text>
            <TextInput
              style={styles.authInput}
              value={authEmail}
              onChangeText={setAuthEmail}
              placeholder="Электронная почта"
              placeholderTextColor="#687386"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!authBusy}
            />
            <TextInput
              style={styles.authInput}
              value={authPassword}
              onChangeText={setAuthPassword}
              placeholder={uiText(language, 'Password (12+ characters)', 'Пароль (от 12 символов)')}
              placeholderTextColor="#687386"
              secureTextEntry
              autoCapitalize="none"
              editable={!authBusy}
            />
            <TouchableOpacity activeOpacity={0.86} style={[styles.authAction, authBusy && styles.disabledButton]} onPress={handleAuthSubmit} disabled={authBusy}>
              {authBusy ? <ActivityIndicator color={WHITE} /> : <Text style={styles.createButtonText}>{authMode === 'login' ? (uiText(language, 'SIGN IN WITH EMAIL', 'ВОЙТИ ПО EMAIL')) : (uiText(language, 'CREATE ACCOUNT', 'СОЗДАТЬ АККАУНТ'))}</Text>}
            </TouchableOpacity>
            {authMode === 'login' && (
              <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={requestEmailLoginLink} disabled={authBusy}>
                <Text style={styles.authLinkText}>{uiText(language, 'Sign in with an email link', 'Войти по ссылке на email')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthNotice(''); }}>
              <Text style={styles.authLinkText}>{authMode === 'login' ? (uiText(language, 'No account? Register', 'Нет аккаунта? Зарегистрироваться')) : (uiText(language, 'Already registered? Sign in', 'Уже есть аккаунт? Войти'))}</Text>
            </TouchableOpacity>
            {!!pendingEmail && (
              <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={resendVerification} disabled={authBusy}>
                <Text style={styles.authLinkText}>{uiText(language, 'Resend verification email', 'Отправить письмо подтверждения повторно')}</Text>
              </TouchableOpacity>
            )}
            {!!authNotice && <Text style={styles.authNotice}>{authNotice}</Text>}
            <Text style={styles.note}>{uiText(language, 'Email verification is required after registration.', 'После регистрации нужно подтвердить email по ссылке из письма.')}</Text>
            <Text style={styles.authLegalText}>Продолжая, вы подтверждаете, что ознакомились с правилами использования приложения и политикой конфиденциальности.</Text>
          </View>}
          </>
        )}
        <View style={styles.profileMenuCard}>
        {['My videos', 'Notifications', 'Settings', 'About', 'Help / FAQ', 'Support'].map((key, menuIndex) => uiText(language, key, ({
          'My videos': 'Мои видео', 'Notifications': 'Уведомления', 'Settings': 'Настройки',
          'About': 'О приложении', 'Help / FAQ': 'Помощь / FAQ', 'Support': 'Поддержка',
        } as Record<string, string>)[key] || key)).map((item, menuIndex) => (
          <TouchableOpacity activeOpacity={0.86}
            key={item}
            style={[styles.menuItem, menuIndex === 5 && styles.menuItemLast]}
            onPress={() => {
              if (item === 'Мои видео') {
                setTab('Gallery');
              } else if (item === 'О приложении') {
                Alert.alert('НейроСцена', 'Твоя творческая студия на компьютере.');
              } else if (item === 'Настройки' || item === 'Settings') {
                Alert.alert('Настройки', 'Настройки приложения');
              } else if (item === (uiText(language, 'Help / FAQ', 'Помощь / FAQ'))) {
                setShowSupport(false);
                setShowNotifications(false);
                setShowFaq(true);
                void loadFaq();
              } else if (item === (uiText(language, 'Support', 'Поддержка'))) {
                setSelectedSupportTicket(null);
                setShowNotifications(false);
                setShowSupport(true);
                void loadSupportTickets();
              } else if (item === (uiText(language, 'Notifications', 'Уведомления'))) {
                setShowSupport(false);
                setShowNotifications(true);
                void loadNotifications();
              } else {
                Alert.alert(item, uiText(language, 'This section will be connected in a later stage.', 'Этот раздел будет подключён на следующем этапе.'));
              }
            }}
          >
            <Text style={styles.menuIcon}>{item === 'Мои видео' ? '▣' : item === 'Уведомления' ? '♧' : item === 'О приложении' ? 'ⓘ' : item === 'Помощь / FAQ' ? '?' : item === 'Поддержка' ? '◌' : '⇥'}</Text>
            <Text style={styles.menuText}>{item}</Text>
            {item === 'Уведомления' && unreadNotifications > 0 && <View style={styles.menuNotificationBadge}><Text style={styles.menuNotificationText}>{Math.min(unreadNotifications, 9)}</Text></View>}
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}
        </View>
        {authToken && ['owner', 'admin'].includes(authUser?.role) && (
          <TouchableOpacity activeOpacity={0.86}
            style={[styles.menuItem, { marginTop: 12, borderBottomColor: BLUE }]}
            onPress={() => { setShowAdminPanel(true); void loadAdminPanel(); }}
          >
            <Text style={[styles.menuText, { color: '#83B7FF' }]}>{uiText(language, 'Admin panel', 'Панель администратора')}</Text>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        )}
        <Text style={styles.version}>НЕЙРОСЦЕНА · {uiText(language, 'VERSION 1.0', 'ВЕРСИЯ 1.0')}</Text>
      </View>
    );
  };

  const activeScreenKey = showAdminPanel ? 'admin' : showNotifications ? 'notifications' : showFaq ? 'faq' : showSupport ? 'support' : tab;

  return (
    <SafeAreaView style={styles.container}>
      <ImageBackground pointerEvents="none" source={require('./assets/neuroscene-cosmic-background.webp')} resizeMode="cover" style={styles.ambientBackdrop} imageStyle={styles.ambientBackdropImage}>
        <View style={styles.ambientBackdropTint} />
        <View style={styles.ambientGlowTop} />
        <View style={styles.ambientGlowBottom} />
        <View style={styles.ambientGlowCenter} />
        <View style={styles.ambientCloudOne} />
        <View style={styles.ambientCloudTwo} />
        <View style={styles.ambientCloudThree} />
        <View style={styles.ambientCloudFour} />
        <View style={styles.ambientLightningOne} />
        <View style={styles.ambientLightningTwo} />
        <View style={styles.ambientWaterReflection} />
        <View style={styles.ambientWaterRippleOne} />
        <View style={styles.ambientWaterRippleTwo} />
        <View style={styles.ambientRing} />
        <View style={styles.ambientRingFar} />
        <View style={styles.ambientHorizon} />
        <View style={styles.ambientStarOne} />
        <View style={styles.ambientStarTwo} />
        <View style={styles.ambientStarThree} />
        <View style={styles.ambientStarFour} />
        <View style={styles.ambientStarFive} />
        <View style={styles.ambientStarSix} />
        <View style={styles.ambientStarSeven} />
        <View style={styles.ambientStarEight} />
      </ImageBackground>
      <StatusBar style="light" hidden={showIntro} />

      {tab === 'Create' && <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandWordmark}>
            <Text style={styles.logo}>Нейро</Text>
            <Text style={styles.logoSecond}>Сцена</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel="Уведомления"
            style={styles.notificationButton}
            onPress={() => { setShowNotifications(true); void loadNotifications(); }}
          >
            <View style={styles.notificationBell}>
              <View style={styles.notificationBellDome} />
              <View style={styles.notificationBellBase} />
              <View style={styles.notificationBellClapper} />
            </View>
            {unreadNotifications > 0 && <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadNotifications > 9 ? '9+' : unreadNotifications}</Text></View>}
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.86}
            accessibilityRole="button"
            accessibilityLabel="Профиль и меню"
            style={styles.headerMenuButton}
            onPress={() => setTab('Profile')}
          >
            <Text style={styles.headerMenuIcon}>☰</Text>
          </TouchableOpacity>
        </View>
      </View>}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, tab === 'Credits' && styles.creditsContent]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        {...swipeResponder.panHandlers}
      >
        {authReady ? <ScreenTransition key={activeScreenKey}>{showTab()}</ScreenTransition> : <ActivityIndicator color={BLUE} style={{ marginTop: 40 }} />}
      </ScrollView>

      <View style={styles.bottomNav}>
        {([
          { id: 'Create', icon: '✧', label: 'Создать' },
          { id: 'Gallery', icon: '▧', label: 'Галерея' },
          { id: 'Credits', icon: '✦', label: 'Кредиты' },
          { id: 'Profile', icon: '◉', label: 'Профиль' },
        ] as const).map((item) => (
          <TouchableOpacity activeOpacity={0.86}
            key={item.id}
            style={[styles.navItem, tab === item.id && styles.navItemActive]}
            onPress={() => { setShowSupport(false); setShowNotifications(false); setShowFaq(false); setShowAdminPanel(false); setTab(item.id); }}
          >
            {item.id === 'Create' ? (
              <View style={[styles.navCreateIcon, tab === item.id && styles.navGlyphActive]} accessibilityLabel="Создать">
                <View style={styles.navCreateTriangle} />
              </View>
            ) : item.id === 'Gallery' ? (
              <View style={[styles.navGalleryIcon, tab === item.id && styles.navGlyphActive]} accessibilityLabel="Галерея">
                <View style={styles.navGalleryCell} /><View style={styles.navGalleryCell} />
                <View style={styles.navGalleryCell} /><View style={styles.navGalleryCell} />
              </View>
            ) : item.id === 'Credits' ? (
              <View style={[styles.navCoin, tab === item.id && styles.navCoinActive]} accessibilityLabel="Монета">
                <View style={styles.navCoinInner}><Text style={styles.navCoinMark}>✦</Text></View>
              </View>
            ) : (
              <View style={styles.navPerson} accessibilityLabel="Человечек">
                <View style={styles.navPersonHead} />
                <View style={styles.navPersonBody} />
              </View>
            )}
            <Text style={[styles.navLabel, tab === item.id && styles.navLabelActive]}>
              {item.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {showIntro && (
        <View style={styles.introOverlay}>
          {(() => {
            const { width, height } = Dimensions.get('window');
            const scale = Math.max(width / 292, height / 674);
            return (
              <View style={styles.splashReferenceViewport}>
                <Image
                  source={require('./НейроСцена_ синяя галактика творчества-3.png')}
                  resizeMode="stretch"
                  style={{
                    position: 'absolute',
                    width: 1536 * scale,
                    height: 1024 * scale,
                    left: -20 * scale,
                    top: (height - 674 * scale) / 2 - 166 * scale,
                  }}
                />
              </View>
            );
          })()}
          <View style={styles.introProgressTrack}>
            <Animated.View style={[styles.introProgressFill, {
              width: splashProgress.interpolate({ inputRange: [0, 1], outputRange: ['2%', '100%'] }),
            }]} />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

type CreateScreenProps = {
  language: Language;
  creditsBalance: number | null;
  creditsLoading: boolean;
  generationType: GenerationType;
  setGenerationType: (value: GenerationType) => void;
  sourceImage: ImagePicker.ImagePickerAsset | null;
  onChooseImage: () => void;
  onRemoveImage: () => void;
  duration: number;
  setDuration: (value: number) => void;
  ratio: string;
  setRatio: (value: string) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  enhancedPrompt: string;
  setEnhancedPrompt: (value: string) => void;
  promptEnhancing: boolean;
  onEnhancePrompt: () => void;
  onCreate: () => void;
  submitting: boolean;
  jobStatus: JobStatus;
  jobId: string | null;
  jobMessage: string;
  pollError: string;
  videoUrl: string | null;
  onOpenVideo: () => void;
  onReset: () => void;
};

function CreateScreen({
  language,
  creditsBalance,
  creditsLoading,
  generationType,
  setGenerationType,
  sourceImage,
  onChooseImage,
  onRemoveImage,
  duration,
  setDuration,
  ratio,
  setRatio,
  prompt,
  setPrompt,
  enhancedPrompt,
  setEnhancedPrompt,
  promptEnhancing,
  onEnhancePrompt,
  onCreate,
  submitting,
  jobStatus,
  jobId,
  jobMessage,
  pollError,
  videoUrl,
  onOpenVideo,
  onReset,
}: CreateScreenProps) {
  const ru = language === 'ru';
  const [showComposer, setShowComposer] = useState(false);
  const [activeFeature, setActiveFeature] = useState<string | null>(null);
  const busy =
    submitting || promptEnhancing || ['queued', 'starting', 'generating', 'uploading'].includes(jobStatus);
  const ctaGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(ctaGlow, { toValue: 1, duration: 1750, useNativeDriver: false }),
      Animated.timing(ctaGlow, { toValue: 0, duration: 1750, useNativeDriver: false }),
    ]));
    pulse.start();
    return () => pulse.stop();
  }, [ctaGlow]);

  return (
    <View>
      <ImageBackground
        source={REFERENCE_HERO_SOURCE}
        resizeMode="cover"
        style={styles.referenceHero}
        imageStyle={{ borderRadius: 26 }}
        accessibilityLabel="Кинематографичная сцена: путешественник на вершине горы перед огромной луной"
      >
        <View style={styles.referenceHeroShade} />
        <View style={styles.referenceHeroCopy}>
          <Text style={styles.referenceHeroTitle}>Создать видео</Text>
          <Text style={styles.referenceHeroCaption}>С помощью искусственного интеллекта</Text>
        </View>

      </ImageBackground>
      <Animated.View style={[styles.referenceCreateGlow, { shadowOpacity: ctaGlow.interpolate({ inputRange: [0,1], outputRange: [0.3,0.78] }), shadowRadius: ctaGlow.interpolate({ inputRange: [0,1], outputRange: [10,22] }) }]}>
        <TouchableOpacity activeOpacity={0.9} style={styles.referenceCreateButton} onPress={() => setShowComposer(true)}>
          <Text style={styles.referencePlay}>▶</Text><Text style={styles.referenceCreateButtonText}>Создать видео</Text>
        </TouchableOpacity>
      </Animated.View>

      {!showComposer && (
        <View style={styles.featureSection}>
          <Text style={styles.featureSectionTitle}>Возможности</Text>
          <View style={styles.featureGrid}>
            {[
              { id: 'text', icon: '▶', title: 'Текст в видео', subtitle: 'Создание по описанию' },
              { id: 'image', icon: '▧', title: 'Изображение в видео', subtitle: 'Оживление изображения' },
              { id: 'sound', icon: '♫', title: 'Добавить звук', subtitle: 'Звуковое оформление' },
              { id: 'prompt', icon: '✧', title: 'Улучшить промпт', subtitle: 'Точнее описать сцену' },
            ].map((feature) => (
              <TouchableOpacity key={feature.id} activeOpacity={0.82}
                onPress={() => {
                  setActiveFeature(feature.id);
                  if (feature.id === 'text' || feature.id === 'prompt') setGenerationType('t2v');
                  if (feature.id === 'image') setGenerationType('i2v');
                }}
                style={[styles.featureTile, activeFeature === feature.id && styles.featureTileActive]}
              >
                <View style={[styles.featureIconSquare, activeFeature === feature.id && styles.featureIconSquareActive]}>
                  <Text style={styles.featureIcon}>{feature.icon}</Text>
                </View>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureSubtitle}>{feature.subtitle}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {showComposer && (
      <>
      <TouchableOpacity activeOpacity={0.86} style={styles.composerBack} onPress={() => setShowComposer(false)}>
        <Text style={styles.composerBackText}>‹ Назад к сцене</Text>
      </TouchableOpacity>
      <View style={styles.modeSelector}>
        <TouchableOpacity activeOpacity={0.86} style={[styles.modeOption, generationType === 't2v' && styles.modeOptionActive]} onPress={() => setGenerationType('t2v')} disabled={busy}>
          <Text style={[styles.modeOptionText, generationType === 't2v' && styles.modeOptionTextActive]}>{uiText(language, 'Text to Video', 'Текст в видео')}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.86} style={[styles.modeOption, generationType === 'i2v' && styles.modeOptionActive]} onPress={() => setGenerationType('i2v')} disabled={busy}>
          <Text style={[styles.modeOptionText, generationType === 'i2v' && styles.modeOptionTextActive]}>{uiText(language, 'Image to Video', 'Изображение в видео')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.engineCard}>
        <View style={styles.engineDot} />
        <View style={{ flex: 1 }}>
          <Text style={styles.engineName}>{uiText(language, 'NeuroScene', 'НейроСцена')}</Text>
          <Text style={styles.engineDescription}>
            {generationType === 'i2v' ? (uiText(language, 'IMAGE TO VIDEO', 'ИЗОБРАЖЕНИЕ В ВИДЕО')) : (uiText(language, 'TEXT TO VIDEO', 'ТЕКСТ В ВИДЕО'))} · {uiText(language, 'LOCAL GENERATION', 'ЛОКАЛЬНАЯ ГЕНЕРАЦИЯ')}
          </Text>
        </View>
        <Text style={styles.engineStatus}>{generationType.toUpperCase()}</Text>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{uiText(language, 'YOUR PROMPT', 'ОПИСАНИЕ СЦЕНЫ')}</Text>
        <Text style={styles.languageLabel}>{uiText(language, 'ENGLISH', 'НА АНГЛИЙСКОМ')}</Text>
      </View>

      <TextInput
        style={styles.prompt}
        placeholder={uiText(language, 'Describe your scene in English. Put spoken dialogue in quotes; Russian lines are kept as written.', 'Опишите сцену на английском. Реплики заключайте в кавычки — русский текст сохранится без перевода.')}
        placeholderTextColor="#687386"
        multiline
        textAlignVertical="top"
        value={prompt}
        onChangeText={setPrompt}
        selectTextOnFocus
        maxLength={2000}
        editable={!busy && !promptEnhancing}
      />

      <Text style={styles.characterCount}>{prompt.length} / 2000</Text>

      <TouchableOpacity activeOpacity={0.86}
        style={[styles.authSecondary, (busy || promptEnhancing || prompt.trim().length < 10) && styles.disabledButton]}
        onPress={onEnhancePrompt}
        disabled={busy || promptEnhancing || prompt.trim().length < 10}
      >
        {promptEnhancing
          ? <ActivityIndicator color={WHITE} />
          : <Text style={styles.authSecondaryText}>{uiText(language, '✨ ENHANCE WITH GEMMA 4 E2B', '✨ УЛУЧШИТЬ ЧЕРЕЗ GEMMA 4 E2B')}</Text>}
      </TouchableOpacity>
      {promptEnhancing && (
        <Text style={styles.note}>{uiText(language, 'Gemma is running locally on your PC. This may take a moment.', 'Gemma работает локально на твоём ПК. Это может занять некоторое время.')}</Text>
      )}
      {!!enhancedPrompt && (
        <View style={styles.imageUploadCard}>
          <Text style={styles.sectionTitle}>{uiText(language, 'IMPROVED PROMPT · GEMMA 4 E2B', 'УЛУЧШЕННЫЙ ПРОМПТ · GEMMA 4 E2B')}</Text>
          <TextInput
            style={styles.prompt}
            value={enhancedPrompt}
            onChangeText={setEnhancedPrompt}
            multiline
            textAlignVertical="top"
            maxLength={4000}
            editable={!busy && !promptEnhancing}
          />
          <Text style={styles.note}>{uiText(language, 'Review and edit the result. It will not be used until you apply it.', 'Проверь и отредактируй результат. Он не будет использован, пока ты его не применишь.')}</Text>
          <TouchableOpacity activeOpacity={0.86}
            style={styles.authAction}
            onPress={() => { setPrompt(enhancedPrompt); setEnhancedPrompt(''); }}
            disabled={busy || promptEnhancing}
          >
            <Text style={styles.createButtonText}>{uiText(language, 'USE IMPROVED PROMPT', 'ИСПОЛЬЗОВАТЬ УЛУЧШЕННЫЙ ПРОМПТ')}</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={() => setEnhancedPrompt('')} disabled={promptEnhancing}>
            <Text style={styles.authLinkText}>{uiText(language, 'Discard result', 'Отклонить результат')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {generationType === 'i2v' && (
        <View style={styles.imageUploadCard}>
          <Text style={styles.sectionTitle}>{uiText(language, 'SOURCE IMAGE', 'ИСХОДНОЕ ИЗОБРАЖЕНИЕ')}</Text>
          {sourceImage ? (
            <View>
              <ImagePickerPreview uri={sourceImage.uri} />
              <Text style={styles.imageFileName} numberOfLines={1}>{sourceImage.fileName || (uiText(language, 'Selected image', 'Выбранное изображение'))}</Text>
              <TouchableOpacity activeOpacity={0.86} style={styles.removeImageButton} onPress={onRemoveImage} disabled={busy}>
                <Text style={styles.removeImageText}>{uiText(language, 'Remove image', 'Удалить изображение')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity activeOpacity={0.86} style={styles.chooseImageButton} onPress={onChooseImage} disabled={busy}>
              <Text style={styles.chooseImageIcon}>＋</Text>
              <Text style={styles.chooseImageText}>{uiText(language, 'Choose image', 'Выбрать изображение')}</Text>
              <Text style={styles.imageHint}>{uiText(language, 'JPEG or PNG · up to 10 MB', 'JPEG или PNG · до 10 МБ')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}


      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{uiText(language, 'DURATION', 'ДЛИТЕЛЬНОСТЬ')}</Text>
      </View>

      <View style={styles.optionRow}>
        {[5, 10].map((value) => (
          <TouchableOpacity activeOpacity={0.86}
            key={value}
            style={[
              styles.option,
              duration === value && styles.selectedOption,
            ]}
            onPress={() => setDuration(value)}
            disabled={busy}
          >
            <Text style={[styles.optionMain, duration === value && styles.activeText]}>
              {value}s
            </Text>
            <Text style={styles.optionSub}>{uiText(language, 'seconds', 'секунд')}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{uiText(language, 'ASPECT RATIO', 'ФОРМАТ КАДРА')}</Text>
      </View>

      <View style={styles.optionRow}>
        {['16:9', '9:16'].map((value) => (
          <TouchableOpacity activeOpacity={0.86}
            key={value}
            style={[
              styles.option,
              ratio === value && styles.selectedOption,
            ]}
            onPress={() => setRatio(value)}
            disabled={busy}
          >
            <Text style={[styles.optionMain, ratio === value && styles.activeText]}>
              {value}
            </Text>
            <Text style={styles.optionSub}>
              {value === '16:9' ? (uiText(language, 'Landscape', 'Горизонтальный')) : (uiText(language, 'Portrait', 'Вертикальный'))}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.costCard}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.costLabel}>{uiText(language, 'GENERATION COST', 'СТОИМОСТЬ ГЕНЕРАЦИИ')}</Text>
          <Text style={styles.costDescription}>
            {uiText(language, 'Generation pricing is not configured yet', 'Расчёт стоимости ещё не подключён')}
          </Text>
        </View>
        <View style={styles.costBalance}>
          <Text style={styles.costBalanceLabel}>БАЛАНС</Text>
          <Text style={styles.costBalanceValue}>{creditsLoading ? '…' : creditsBalance === null ? '—' : creditsBalance.toLocaleString('ru-RU')}</Text>
        </View>
        <Text style={styles.costIcon}>✦</Text>
      </View>

      <TouchableOpacity activeOpacity={0.86}
        style={[styles.createButton, busy && styles.disabledButton]}
        onPress={onCreate}
        disabled={busy}
      >
        {submitting ? (
          <ActivityIndicator color={WHITE} />
        ) : (
          <Text style={styles.createButtonText}>
            {busy ? (uiText(language, 'GENERATION IN PROGRESS', 'ГЕНЕРАЦИЯ ВЫПОЛНЯЕТСЯ')) : (uiText(language, '✦  CREATE VIDEO', '✦  СОЗДАТЬ ВИДЕО'))}
          </Text>
        )}
      </TouchableOpacity>

      {jobStatus !== 'idle' && (
        <View style={styles.statusCard}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusTitle}>{uiText(language, 'GENERATION STATUS', 'СТАТУС ГЕНЕРАЦИИ')}</Text>
            {busy && <ActivityIndicator color={BLUE} size="small" />}
          </View>

          <Text style={[styles.statusValue, jobStatus === 'completed' && styles.statusSuccess]}>
            {busy
              ? (uiText(language, 'NeuroScene is creating your video', 'НейроСцена создаёт видео'))
              : jobStatus === 'completed'
                ? (uiText(language, 'Video ready', 'Видео готово'))
                : (uiText(language, 'Generation error', 'Ошибка генерации'))}
          </Text>{!busy && <Text style={[styles.statusDescription, jobStatus === 'completed' && styles.statusSuccess]}>{jobMessage}</Text>}

          {jobId && (
            <Text style={styles.jobId}>ID: {jobId}</Text>
          )}

          {pollError !== '' && (
            <Text style={styles.errorText}>
              {uiText(language, 'Status error:', 'Ошибка получения статуса:')} {pollError}
            </Text>
          )}

          {jobStatus === 'completed' && videoUrl && (
            <TouchableOpacity activeOpacity={0.86} style={styles.secondaryButton} onPress={onOpenVideo}>
              <Text style={styles.secondaryButtonText}>{uiText(language, 'Open completed video', 'Открыть готовое видео')}</Text>
            </TouchableOpacity>
          )}

          {jobStatus === 'completed' && !videoUrl && (
            <Text style={styles.note}>
              {uiText(language, 'The job is complete, but the Backend did not return a video link.', 'Задача завершена. Ссылка на видео не найдена в ответе Backend.')}
            </Text>
          )}

          {(jobStatus === 'completed' || jobStatus === 'failed') && (
            <TouchableOpacity activeOpacity={0.86} style={styles.resetButton} onPress={onReset}>
              <Text style={styles.resetButtonText}>{uiText(language, 'New generation', 'Новая генерация')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Text style={styles.footerNote}>
        {uiText(language, 'Your imagination. Your frame. Your story.', 'ТВОЯ ИДЕЯ. ТВОЙ КАДР. ТВОЯ ИСТОРИЯ.')}
      </Text>
      </>
      )}
      <Modal
        visible={submitting || ['queued', 'starting', 'generating', 'uploading'].includes(jobStatus)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => undefined}
      >
        <View style={styles.generationModalBackdrop}>
          <View style={styles.generationModalCard}>
            <View style={styles.generationModalMark}><Text style={styles.generationModalMarkText}>Н+С</Text></View>
            <ActivityIndicator color={BLUE} size="large" style={{ marginTop: 22 }} />
            <Text style={styles.generationModalTitle}>НейроСцена создаёт видео</Text>
            <Text style={styles.generationModalDescription}>{jobMessage || 'Подготавливаем генерацию. Пожалуйста, подождите.'}</Text>
            <Text style={styles.generationModalHint}>Не закрывайте приложение во время генерации</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function GalleryScreen({
  items,
  language,
  loading,
  error,
  onRefresh,
  onCopyPrompt,
  onRegenerate,
  onExport,
  onDelete,
  onCreate,
}: {
  items: any[];
  language: Language;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onCopyPrompt: (prompt: string) => void;
  onRegenerate: (item: any) => void;
  onExport: (url: string, jobId: string) => void;
  onDelete: (jobId: string) => void;
  onCreate: () => void;
}) {
  const ru = language === 'ru';
  const visibleItems = items;
  return (
    <View style={styles.screen}>
      <View style={styles.galleryTitleWrap}>
        <Text style={styles.galleryTitle}>Мои видео</Text>
        <View style={styles.galleryTitleGlow} />
        <TouchableOpacity activeOpacity={0.86} style={styles.galleryRefreshButton} onPress={onRefresh} accessibilityLabel="Обновить галерею">
          <Text style={styles.galleryFilterIcon}>↻</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator color={BLUE} style={{ marginTop: 20 }} />}
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {!loading && visibleItems.length === 0 && (
        <View style={styles.emptyScreen}>
          <Text style={styles.emptyIcon}>▤</Text>
          <Text style={styles.description}>{uiText(language, 'Your completed videos will appear here.', 'Здесь появятся ваши видео')}</Text>
          <TouchableOpacity activeOpacity={0.86} style={styles.secondaryButton} onPress={onCreate}><Text style={styles.secondaryButtonText}>{uiText(language, 'Create your first video', 'Создать видео')}</Text></TouchableOpacity>
        </View>
      )}

      <View style={styles.galleryGrid}>
      {visibleItems.map((item) => {
        const url = readVideoUrl(item);
        if (!url) return null;
        const rawDuration = item.duration_seconds ?? item.duration ?? item.duration_sec ?? '';
        const durationSeconds = Number(rawDuration);
        const durationLabel = typeof rawDuration === 'string' && /^\d{1,2}:\d{2}$/.test(rawDuration)
          ? rawDuration
          : durationSeconds > 0
            ? `${String(Math.floor(durationSeconds / 60)).padStart(2, '0')}:${String(Math.floor(durationSeconds % 60)).padStart(2, '0')}`
            : '';
        return (
          <View key={item.job_id} style={styles.galleryCard}>
            <View style={styles.galleryPreview}>
              <GalleryVideoPlayer uri={url} />
              {!!durationLabel && <Text style={styles.galleryDuration}>{durationLabel}</Text>}

            </View>
            <Text style={[styles.galleryDate, { display: 'none' }]}>
              {item.created_at
                ? new Date(item.created_at).toLocaleString('ru-RU')
                : (uiText(language, 'Date unavailable', 'Дата не указана'))}
            </Text>
            {!!item.expires_at && (
              <Text style={[styles.galleryDate, { display: 'none' }, item.expires_soon && { color: '#FFB36B' }]}>
                {item.expires_soon
                  ? (uiText(language, 'Scheduled for deletion: ', 'Скоро удалится: '))
                  : (uiText(language, 'Auto-delete date: ', 'Удаление через 30 дней: '))}
                {new Date(item.expires_at).toLocaleDateString('ru-RU')}
              </Text>
            )}
            <Text style={[styles.galleryPrompt, { display: 'none' }]} numberOfLines={3}>
              {item.prompt || (uiText(language, 'No prompt', 'Без описания'))}
            </Text>
            <View style={[styles.galleryActions, { display: 'none' }]}>
              <TouchableOpacity activeOpacity={0.86}
                style={styles.galleryActionButton}
                disabled={!item.prompt}
                onPress={() => onCopyPrompt(String(item.prompt || ''))}
              >
                <Text style={styles.galleryActionText}>{uiText(language, 'Copy prompt', 'Копировать промпт')}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.86}
                style={styles.galleryActionButton}
                onPress={() => onRegenerate(item)}
              >
                <Text style={styles.galleryActionText}>{uiText(language, 'Regenerate', 'Повторить')}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.86}
                style={styles.galleryActionButton}
                onPress={() => onExport(url, String(item.job_id))}
              >
                <Text style={styles.galleryActionText}>{uiText(language, 'Download / share', 'Скачать / отправить')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity activeOpacity={0.86}
              style={styles.deleteVideoButton}
              onPress={() =>
                Alert.alert(
                  uiText(language, 'Delete video?', 'Удалить видео?'),
                  uiText(language, 'The video and its file will be permanently deleted.', 'Видео и его файл будут удалены без возможности восстановления.'),
                  [
                    { text: uiText(language, 'Cancel', 'Отмена'), style: 'cancel' },
                    {
                      text: uiText(language, 'Delete', 'Удалить'),
                      style: 'destructive',
                      onPress: () => onDelete(item.job_id),
                    },
                  ]
                )
              }
            >
              <Text style={styles.deleteVideoText}>{uiText(language, 'Delete video', 'Удалить видео')}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
      </View>
      <Text style={styles.galleryLimit}>{uiText(language, 'Storage available {count}/2', `Доступно для хранения: ${items.length}/2`).replace('{count}', String(items.length))}</Text>
      <View style={styles.storageTrack}><View style={[styles.storageProgress, { width: `${Math.min(items.length / 2 * 100, 100)}%` }]} /></View>
    </View>
  );
}

function NotificationScreen({
  language,
  items,
  unreadCount,
  loading,
  onBack,
  onRefresh,
  onRead,
  onReadAll,
}: {
  language: Language;
  items: any[];
  unreadCount: number;
  loading: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onRead: (id: string) => void;
  onReadAll: () => void;
}) {
  const ru = language === 'ru';
  return (
    <View style={styles.screen}>
      <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onBack}>
        <Text style={styles.smallActionText}>{uiText(language, '‹ Back', '‹ Назад')}</Text>
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
        <View>
          <Text style={styles.eyebrow}>{uiText(language, 'ACCOUNT UPDATES', 'ВАЖНЫЕ СОБЫТИЯ')}</Text>
          <Text style={styles.screenTitle}>{uiText(language, 'Notifications', 'Уведомления')}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.packageAmount}>{unreadCount}</Text>
          <Text style={styles.mutedText}>{uiText(language, 'unread', 'непрочитано')}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onRefresh}>
          <Text style={styles.smallActionText}>{uiText(language, 'Refresh', 'Обновить')}</Text>
        </TouchableOpacity>
        {unreadCount > 0 && (
          <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={onReadAll}>
            <Text style={styles.authLinkText}>{uiText(language, 'Mark all read', 'Прочитать все')}</Text>
          </TouchableOpacity>
        )}
      </View>
      {loading && <ActivityIndicator color={BLUE} style={{ marginTop: 18 }} />}
      {!loading && items.length === 0 && <Text style={styles.note}>{uiText(language, 'No notifications yet.', 'Уведомлений пока нет.')}</Text>}
      {items.map((item) => (
        <TouchableOpacity activeOpacity={0.86}
          key={item.notification_id}
          style={[styles.galleryCard, { marginTop: 9, borderColor: item.read_at ? '#253147' : BLUE }]}
          onPress={() => !item.read_at && onRead(item.notification_id)}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.packageAmount}>{item.title}</Text>
            {!item.read_at && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: BLUE }} />}
          </View>
          <Text style={styles.description}>{item.body}</Text>
          <Text style={styles.galleryDate}>
            {item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : ''}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

type AdminScreenProps = {
  language: Language;
  users: any[];
  audit: any[];
  generations: any[];
  workers: any[];
  analytics: any | null;
  loading: boolean;
  onSetPriority: (jobId: string, priority: number) => void;
  onCancelGeneration: (jobId: string) => void;
  onRetryGeneration: (jobId: string) => void;
  error: string;
  isOwner: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onAdjust: (userId: string, amount: number, reason: string) => void;
  onChangeRole: (userId: string, role: 'user' | 'admin' | 'support', reason: string) => void;
  onOpenFaq: () => void;
};

function AdminScreen({ language, users, audit, generations, workers, analytics, loading, error, isOwner, onBack, onRefresh, onAdjust, onChangeRole, onSetPriority, onCancelGeneration, onRetryGeneration, onOpenFaq }: AdminScreenProps) {
  const ru = language === 'ru';
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  useEffect(() => {
    const timer = setInterval(() => { void refreshRef.current(); }, 30000);
    return () => clearInterval(timer);
  }, []);
  const [queueFilter, setQueueFilter] = useState<'all' | 'queued' | 'failed'>('all');
  const visibleGenerations = generations.filter((item) => queueFilter === 'all' || item.status === queueFilter);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [creditAmount, setCreditAmount] = useState('25');
  const [creditReason, setCreditReason] = useState('');
  const [roleReason, setRoleReason] = useState('');
  const selectedUser = users.find((user) => user.id === selectedUserId);
  const parsedAmount = Number(creditAmount);

  return (
    <View style={styles.screen}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onBack}>
          <Text style={styles.smallActionText}>{uiText(language, 'Back', 'Назад')}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onRefresh} disabled={loading}>
          <Text style={styles.smallActionText}>{uiText(language, 'Refresh', 'Обновить')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.eyebrow}>{uiText(language, 'SERVICE MANAGEMENT', 'УПРАВЛЕНИЕ СЕРВИСОМ')}</Text>
      <Text style={styles.screenTitle}>{uiText(language, 'Admin panel', 'Панель администратора')}</Text>
      <TouchableOpacity activeOpacity={0.86} style={[styles.authSecondary, { marginTop: 12 }]} onPress={onOpenFaq}>
        <Text style={styles.authSecondaryText}>{uiText(language, 'Manage FAQ', 'Управление FAQ')}</Text>
      </TouchableOpacity>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {loading && <ActivityIndicator color={BLUE} style={{ marginVertical: 16 }} />}

      <View style={{ marginTop: 22 }}>
        <Text style={styles.sectionTitle}>{uiText(language, 'SERVICE ANALYTICS', 'АНАЛИТИКА СЕРВИСА')}</Text>
        {!analytics && <Text style={styles.note}>{uiText(language, 'Analytics data is not loaded yet.', 'Данные аналитики пока не загружены.')}</Text>}
        {!!analytics && (
          <>
            <Text style={styles.packageAmount}>{uiText(language, 'Users', 'Пользователи')}: {analytics.users.total} · {uiText(language, 'active accounts', 'активные аккаунты')}: {analytics.users.active_accounts} · {uiText(language, 'blocked', 'заблокированы')}: {analytics.users.blocked_accounts}</Text>
            <Text style={styles.mutedText}>{uiText(language, 'Registrations: 7 days', 'Регистрации: 7 дней')} {analytics.users.registered_7d} · 30 {uiText(language, 'days', 'дней')} {analytics.users.registered_30d}</Text>
            <Text style={styles.mutedText}>{uiText(language, 'Created at least one video', 'Создали хотя бы одно видео')}: {analytics.users.users_with_generation} ({analytics.users.generation_conversion_percent}%)</Text>
            <Text style={[styles.packageAmount, { marginTop: 12 }]}>{uiText(language, 'Generations', 'Генерации')}: {analytics.generations.total}</Text>
            <Text style={styles.mutedText}>{uiText(language, 'Completed', 'Успешно')}: {analytics.generations.completed} · {uiText(language, 'failed', 'ошибки')}: {analytics.generations.failed} · {uiText(language, 'active', 'активные')}: {analytics.generations.active}</Text>
            <Text style={styles.mutedText}>{uiText(language, 'Completion rate', 'Доля успешных завершений')}: {analytics.generations.completion_rate_percent}%</Text>
            <Text style={[styles.mutedText, { marginTop: 10 }]}>{ru ? 'Финансовая аналитика пока недоступна: реальные платежи и учёт затрат GPU ещё не подключены.' : analytics.financial_metrics_note}</Text>
            <Text style={styles.eyebrow}>{uiText(language, 'LAST 14 DAYS · SIGNUPS', 'ПОСЛЕДНИЕ 14 ДНЕЙ · РЕГИСТРАЦИИ')}</Text>
            {analytics.daily_users.length === 0 && <Text style={styles.note}>—</Text>}
            {analytics.daily_users.map((day: any) => <Text key={'u-' + day.day} style={styles.mutedText}>{day.day}: {day.count}</Text>)}
            <Text style={[styles.eyebrow, { marginTop: 12 }]}>{uiText(language, 'LAST 14 DAYS · GENERATIONS', 'ПОСЛЕДНИЕ 14 ДНЕЙ · ГЕНЕРАЦИИ')}</Text>
            {analytics.daily_generations.length === 0 && <Text style={styles.note}>—</Text>}
            {analytics.daily_generations.map((day: any) => <Text key={'g-' + day.day} style={styles.mutedText}>{day.day}: {day.total} · ✓ {day.completed || 0} · ✕ {day.failed || 0}</Text>)}
          </>
        )}
      </View>

      <View style={{ marginTop: 22 }}>
        <Text style={styles.sectionTitle}>{uiText(language, 'GPU WORKERS', 'GPU-ВОРКЕРЫ')} · {workers.length}</Text>
        {workers.length === 0 && <Text style={styles.note}>{uiText(language, 'No telemetry yet. A worker appears after the GPU Agent sends its first heartbeat.', 'Пока нет телеметрии. Worker появится после отправки первого heartbeat от GPU Agent.')}</Text>}
        {workers.map((worker) => {
          const vramPercent = Math.round(worker.vram_used_mb / Math.max(1, worker.vram_total_mb) * 100);
          const stateLabel = worker.health === 'offline'
            ? (uiText(language, 'OFFLINE', 'НЕТ СВЯЗИ'))
            : worker.health === 'warning'
              ? (uiText(language, 'WARNING', 'ТРЕБУЕТ ВНИМАНИЯ'))
              : (uiText(language, 'ONLINE', 'В СЕТИ'));
          return (
            <View key={worker.worker_id} style={styles.packageCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.packageAmount}>{worker.gpu_name}</Text>
                <Text style={styles.mutedText}>{worker.worker_id} · {worker.worker_version}</Text>
                <Text style={styles.mutedText}>{stateLabel} · {worker.status} · {uiText(language, 'seen', 'связь')} {worker.heartbeat_age_seconds}s {uiText(language, 'ago', 'назад')}</Text>
                <Text style={styles.mutedText}>GPU {worker.gpu_utilization_percent}% · VRAM {worker.vram_used_mb}/{worker.vram_total_mb} MB ({vramPercent}%) · {worker.temperature_c}°C</Text>
                <Text style={styles.mutedText}>{uiText(language, 'Active jobs', 'Активных задач')}: {worker.active_job_count} · {uiText(language, 'Worker queue', 'Очередь worker')}: {worker.queue_depth}</Text>
                {!!worker.alerts?.length && <Text style={styles.errorText}>{worker.alerts.map((alert: string) => ({
                  heartbeat_stale: uiText(language, 'Heartbeat missing for over 90 seconds', 'Нет heartbeat более 90 секунд'),
                  worker_error: uiText(language, 'Worker reported an error', 'Worker сообщил об ошибке'),
                  gpu_temperature_high: uiText(language, 'High GPU temperature', 'Высокая температура GPU'),
                  vram_near_limit: uiText(language, 'VRAM near capacity', 'VRAM почти заполнена'),
                  queue_overflow: uiText(language, 'Worker queue is high', 'Большая очередь worker'),
                }[alert] || alert)).join(' · ')}</Text>}
                {!!worker.last_error && <Text style={styles.mutedText}>{worker.last_error}</Text>}
              </View>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>{uiText(language, 'USERS', 'ПОЛЬЗОВАТЕЛИ')} · {users.length}</Text>
      {users.map((user) => (
        <TouchableOpacity activeOpacity={0.86}
          key={user.id}
          style={[styles.packageCard, selectedUserId === user.id && { borderColor: BLUE }]}
          onPress={() => setSelectedUserId(user.id)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.packageAmount}>{user.email}</Text>
            <Text style={styles.mutedText}>{user.role} · {user.status}</Text>
            <Text style={styles.mutedText}>{uiText(language, 'Balance', 'Баланс')}: {user.credit_balance} ✦</Text>
          </View>
          <Text style={styles.smallActionText}>{selectedUserId === user.id ? '✓' : '›'}</Text>
        </TouchableOpacity>
      ))}

      {selectedUser && (
        <View style={[styles.authCard, { marginTop: 18 }]}>
          <Text style={styles.sectionTitle}>{uiText(language, 'ADJUST CREDITS', 'ИЗМЕНИТЬ БАЛАНС')}</Text>
          <Text style={styles.mutedText}>{selectedUser.email}</Text>
          <TextInput
            style={styles.authInput}
            value={creditAmount}
            onChangeText={setCreditAmount}
            keyboardType="numbers-and-punctuation"
            placeholder={uiText(language, 'Credit amount (+/-)', 'Количество кредитов (+/-)')}
            placeholderTextColor="#687386"
          />
          <TextInput
            style={styles.authInput}
            value={creditReason}
            onChangeText={setCreditReason}
            maxLength={300}
            placeholder={uiText(language, 'Reason (at least 5 characters)', 'Причина (не менее 5 символов)')}
            placeholderTextColor="#687386"
          />
          <TouchableOpacity activeOpacity={0.86}
            style={[styles.authAction, (loading || !Number.isSafeInteger(parsedAmount) || parsedAmount === 0 || creditReason.trim().length < 5) && styles.disabledButton]}
            disabled={loading || !Number.isSafeInteger(parsedAmount) || parsedAmount === 0 || creditReason.trim().length < 5}
            onPress={() => {
              onAdjust(selectedUser.id, parsedAmount, creditReason.trim());
            }}
          >
            <Text style={styles.createButtonText}>{uiText(language, 'CONFIRM ADJUSTMENT', 'ПОДТВЕРДИТЬ КОРРЕКТИРОВКУ')}</Text>
          </TouchableOpacity>

          {isOwner && selectedUser.role !== 'owner' && (
            <View style={{ marginTop: 22 }}>
              <Text style={styles.sectionTitle}>{uiText(language, 'ASSIGN ROLE', 'НАЗНАЧИТЬ РОЛЬ')}</Text>
              <TextInput
                style={styles.authInput}
                value={roleReason}
                onChangeText={setRoleReason}
                maxLength={300}
                placeholder={uiText(language, 'Reason for role change', 'Причина изменения роли')}
                placeholderTextColor="#687386"
              />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                {(['user', 'admin', 'support'] as const).map((role) => (
                  <TouchableOpacity activeOpacity={0.86}
                    key={role}
                    style={[styles.smallAction, { opacity: loading || selectedUser.role === role || roleReason.trim().length < 5 ? 0.5 : 1 }]}
                    disabled={loading || selectedUser.role === role || roleReason.trim().length < 5}
                    onPress={() => {
                      onChangeRole(selectedUser.id, role, roleReason.trim());
                    }}
                  >
                    <Text style={styles.smallActionText}>{role}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      <View style={{ marginTop: 26 }}>
        <Text style={styles.sectionTitle}>{uiText(language, 'GENERATION QUEUE', 'ОЧЕРЕДЬ ГЕНЕРАЦИЙ')} · {visibleGenerations.length}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {([
            ['all', uiText(language, 'All', 'Все')],
            ['queued', uiText(language, 'Queued', 'В очереди')],
            ['failed', uiText(language, 'Failed', 'Ошибки')],
          ] as const).map(([value, label]) => (
            <TouchableOpacity activeOpacity={0.86}
              key={value}
              style={[styles.smallAction, queueFilter === value && { borderColor: BLUE, backgroundColor: 'rgba(57,120,255,0.14)' }]}
              onPress={() => setQueueFilter(value)}
            >
              <Text style={styles.smallActionText}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {visibleGenerations.length === 0 && <Text style={styles.note}>{uiText(language, 'No jobs for this filter.', 'Заданий для этого фильтра нет.')}</Text>}
        {visibleGenerations.map((job) => (
          <View key={job.job_id} style={styles.packageCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.packageAmount}>{job.email || (uiText(language, 'Guest / deleted account', 'Гость / удалённый аккаунт'))}</Text>
              <Text style={styles.mutedText}>{job.status} · {job.generation_type} · {job.duration}s · {job.aspect_ratio}</Text>
              <Text style={styles.mutedText}>{uiText(language, 'Attempts', 'Попытки')}: {job.attempt_count} · {uiText(language, 'Priority', 'Приоритет')}: {job.priority}</Text>
              <Text style={styles.galleryDate}>{job.created_at ? new Date(job.created_at).toLocaleString('ru-RU') : ''}</Text>
              {!!job.message && <Text style={styles.note}>{job.message}</Text>}
            </View>
            {job.status === 'queued' && (
              <View style={{ gap: 7, alignItems: 'flex-end' }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} disabled={loading || job.priority <= -100} onPress={() => onSetPriority(job.job_id, Math.max(-100, Number(job.priority || 0) - 1))}>
                    <Text style={styles.smallActionText}>−</Text>
                  </TouchableOpacity>
                  <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} disabled={loading || job.priority >= 100} onPress={() => onSetPriority(job.job_id, Math.min(100, Number(job.priority || 0) + 1))}>
                    <Text style={styles.smallActionText}>＋</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} disabled={loading} onPress={() => onCancelGeneration(job.job_id)}>
                  <Text style={styles.deleteVideoText}>{uiText(language, 'Cancel', 'Отменить')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {job.status === 'failed' && job.generation_type === 't2v' && (
              <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} disabled={loading} onPress={() => onRetryGeneration(job.job_id)}>
                <Text style={styles.smallActionText}>{uiText(language, 'Retry', 'Повторить')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>

      <View style={{ marginTop: 26 }}>
        <Text style={styles.sectionTitle}>{uiText(language, 'AUDIT LOG', 'ЖУРНАЛ АУДИТА')}</Text>
        {audit.length === 0 && !loading && <Text style={styles.note}>{uiText(language, 'No audit entries yet.', 'Записей пока нет.')}</Text>}
        {audit.map((entry) => (
          <View key={entry.audit_id} style={styles.packageCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.packageAmount}>{entry.action}</Text>
              <Text style={styles.mutedText}>{entry.actor_email} → {entry.target_email}</Text>
              <Text style={styles.mutedText}>{entry.reason}</Text>
              <Text style={styles.galleryDate}>{entry.created_at ? new Date(entry.created_at).toLocaleString('ru-RU') : ''}</Text>
            </View>
          </View>
        ))}
      </View>
      <Text style={styles.note}>{uiText(language, 'Credit and role changes require confirmation and are stored in an immutable audit log.', 'Изменения баланса и ролей подтверждаются отдельно и сохраняются в неизменяемом журнале.')}</Text>
    </View>
  );
}

function FAQScreen({
  language,
  items,
  loading,
  error,
  isAdmin,
  onBack,
  onRefresh,
  onSave,
}: {
  language: Language;
  items: any[];
  loading: boolean;
  error: string;
  isAdmin: boolean;
  onBack: () => void;
  onRefresh: () => void;
  onSave: (entry: any, faqId?: string) => Promise<boolean>;
}) {
  const ru = language === 'ru';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [formCategory, setFormCategory] = useState('generation');
  const [questionRu, setQuestionRu] = useState('');
  const [answerRu, setAnswerRu] = useState('');
  const [sortOrder, setSortOrder] = useState('100');
  const [isActive, setIsActive] = useState(true);
  const categories = [
    ['all', uiText(language, 'All', 'Все')],
    ['generation', uiText(language, 'Generation', 'Генерация')],
    ['gallery', uiText(language, 'Gallery', 'Галерея')],
    ['account', uiText(language, 'Account', 'Аккаунт')],
    ['credits', uiText(language, 'Credits', 'Кредиты')],
  ] as const;
  const categoryName = (value: string) => categories.find((item) => item[0] === value)?.[1] || value;
  const visibleItems = items.filter((item) => {
    if (category !== 'all' && item.category !== category) return false;
    const text = faqText(language, item, 'question') + ' ' + faqText(language, item, 'answer');
    return text.toLowerCase().includes(search.trim().toLowerCase());
  });
  const clearForm = () => {
    setEditingId(undefined);
    setFormCategory('generation');
    setQuestionRu('');
    setAnswerRu('');
    setSortOrder('100');
    setIsActive(true);
  };
  const editItem = (item: any) => {
    setEditingId(item.faq_id);
    setFormCategory(item.category);
    setQuestionRu(item.question_ru);
    setAnswerRu(item.answer_ru);
    setSortOrder(String(item.sort_order ?? 0));
    setIsActive(!!item.is_active);
  };
  const submit = async () => {
    const order = Number(sortOrder);
    if (!Number.isSafeInteger(order) || order < -10000 || order > 10000) return;
    if ([questionRu, answerRu].some((value) => value.trim().length < 3)) return;
    const saved = await onSave({
      category: formCategory,
      question_ru: questionRu.trim(),
      answer_ru: answerRu.trim(),
      question_en: questionRu.trim(),
      answer_en: answerRu.trim(),
      sort_order: order,
      is_active: isActive,
    }, editingId);
    if (saved) clearForm();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onBack}>
          <Text style={styles.smallActionText}>{uiText(language, '‹ Back', '‹ Назад')}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onRefresh} disabled={loading}>
          <Text style={styles.smallActionText}>{uiText(language, 'Refresh', 'Обновить')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.eyebrow}>{uiText(language, 'HELP CENTER', 'ЦЕНТР ПОМОЩИ')}</Text>
      <Text style={styles.screenTitle}>FAQ</Text>
      <TextInput
        style={styles.authInput}
        value={search}
        onChangeText={setSearch}
        placeholder={uiText(language, 'Search questions and answers', 'Поиск по вопросам и ответам')}
        placeholderTextColor="#687386"
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 }}>
        {categories.map(([value, label]) => (
          <TouchableOpacity activeOpacity={0.86} key={value} style={[styles.smallAction, category === value && { borderColor: BLUE }]} onPress={() => setCategory(value)}>
            <Text style={styles.smallActionText}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {loading && <ActivityIndicator color={BLUE} style={{ marginVertical: 12 }} />}
      {!loading && visibleItems.length === 0 && <Text style={styles.note}>{uiText(language, 'No matching questions found.', 'По этому запросу ничего не найдено.')}</Text>}
      {visibleItems.map((item) => (
        <View key={item.faq_id} style={styles.galleryCard}>
          <Text style={styles.eyebrow}>{categoryName(item.category)}{!item.is_active ? ' · ' + (uiText(language, 'HIDDEN', 'СКРЫТО')) : ''}</Text>
          <Text style={styles.packageAmount}>{faqText(language, item, 'question')}</Text>
          <Text style={styles.description}>{faqText(language, item, 'answer')}</Text>
          {isAdmin && (
            <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={() => editItem(item)}>
              <Text style={styles.authLinkText}>{uiText(language, 'Edit', 'Редактировать')}</Text>
            </TouchableOpacity>
          )}
        </View>
      ))}
      {isAdmin && (
        <View style={[styles.authCard, { marginTop: 20 }]}>
          <Text style={styles.sectionTitle}>{editingId ? (uiText(language, 'EDIT FAQ ENTRY', 'РЕДАКТИРОВАТЬ ВОПРОС')) : (uiText(language, 'ADD FAQ ENTRY', 'ДОБАВИТЬ ВОПРОС'))}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {categories.filter((item) => item[0] !== 'all').map(([value, label]) => (
              <TouchableOpacity activeOpacity={0.86} key={value} style={[styles.smallAction, formCategory === value && { borderColor: BLUE }]} onPress={() => setFormCategory(value)}>
                <Text style={styles.smallActionText}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput style={styles.authInput} value={questionRu} onChangeText={setQuestionRu} maxLength={240} placeholder="Вопрос на русском" placeholderTextColor="#687386" />
          <TextInput style={[styles.authInput, { minHeight: 90, textAlignVertical: 'top' }]} value={answerRu} onChangeText={setAnswerRu} maxLength={3000} multiline placeholder="Ответ на русском" placeholderTextColor="#687386" />
          <TextInput style={styles.authInput} value={sortOrder} onChangeText={setSortOrder} keyboardType="numbers-and-punctuation" placeholder={uiText(language, 'Display order', 'Порядок отображения')} placeholderTextColor="#687386" />
          <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={() => setIsActive((value) => !value)}>
            <Text style={styles.authLinkText}>{isActive ? (uiText(language, '● Visible to users', '● Показывать пользователям')) : (uiText(language, '○ Hidden from users', '○ Скрыто от пользователей'))}</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.86} style={[styles.authAction, loading && styles.disabledButton]} onPress={submit} disabled={loading || [questionRu, answerRu].some((value) => value.trim().length < 3) || !Number.isSafeInteger(Number(sortOrder))}>
            <Text style={styles.createButtonText}>{uiText(language, 'SAVE FAQ', 'СОХРАНИТЬ FAQ')}</Text>
          </TouchableOpacity>
          {!!editingId && (
            <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={clearForm}>
              <Text style={styles.authLinkText}>{uiText(language, 'Cancel editing', 'Отменить редактирование')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </ScrollView>
  );
}

function SupportScreen({
  language,
  authenticated,
  staffRole,
  filter,
  setFilter,
  onCloseTicket,
  tickets,
  selectedTicket,
  loading,
  busy,
  error,
  category,
  setCategory,
  description,
  setDescription,
  message,
  setMessage,
  files,
  onChooseFiles,
  onRemoveFile,
  onBack,
  onBackToList,
  onSignIn,
  onRefresh,
  onCreate,
  onOpen,
  onOpenAttachment,
  onSend,
}: {
  language: Language;
  authenticated: boolean;
  staffRole: string;
  filter: 'new' | 'in_progress' | 'closed';
  setFilter: (value: 'new' | 'in_progress' | 'closed') => void;
  onCloseTicket: () => void;
  tickets: any[];
  selectedTicket: any | null;
  loading: boolean;
  busy: boolean;
  error: string;
  category: 'generation' | 'payment' | 'account' | 'other';
  setCategory: (value: 'generation' | 'payment' | 'account' | 'other') => void;
  description: string;
  setDescription: (value: string) => void;
  message: string;
  setMessage: (value: string) => void;
  files: ImagePicker.ImagePickerAsset[];
  onChooseFiles: () => void;
  onRemoveFile: (index: number) => void;
  onBack: () => void;
  onBackToList: () => void;
  onSignIn: () => void;
  onRefresh: () => void;
  onCreate: () => void;
  onOpen: (ticketId: string) => void;
  onOpenAttachment: (attachment: any) => void;
  onSend: () => void;
}) {
  const ru = language === 'ru';
  const isStaff = ['owner', 'admin', 'support'].includes(staffRole);
  const categoryLabels: Record<string, string> = {
    generation: uiText(language, 'Generation', 'Генерация'),
    payment: uiText(language, 'Payment', 'Оплата'),
    account: uiText(language, 'Account', 'Аккаунт'),
    other: uiText(language, 'Other', 'Другое'),
  };
  const statusLabels: Record<string, string> = {
    new: uiText(language, 'New', 'Новое'),
    in_progress: uiText(language, 'In progress', 'В работе'),
    closed: uiText(language, 'Closed', 'Закрыто'),
  };

  return (
    <View style={styles.screen}>
      <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onBack}>
        <Text style={styles.smallActionText}>{uiText(language, '‹ Back', '‹ Назад')}</Text>
      </TouchableOpacity>
      <Text style={styles.eyebrow}>{uiText(language, 'WE ARE HERE TO HELP', 'МЫ НА СВЯЗИ')}</Text>
      <Text style={styles.screenTitle}>{isStaff ? (uiText(language, 'Support inbox', 'Очередь поддержки')) : (uiText(language, 'Support', 'Поддержка'))}</Text>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {!authenticated ? (
        <View style={styles.emptyScreen}>
          <Text style={styles.description}>{uiText(language, 'Sign in to create a ticket and view replies.', 'Чтобы создать обращение и видеть ответы, войдите в аккаунт.')}</Text>
          <TouchableOpacity activeOpacity={0.86} style={styles.secondaryButton} onPress={onSignIn}>
            <Text style={styles.secondaryButtonText}>{uiText(language, 'Sign in', 'Войти в аккаунт')}</Text>
          </TouchableOpacity>
        </View>
      ) : selectedTicket ? (
        <View>
          <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={onBackToList}>
            <Text style={styles.authLinkText}>{uiText(language, 'Back to tickets', 'К списку обращений')}</Text>
          </TouchableOpacity>
          <View style={styles.packageCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.packageAmount}>{categoryLabels[selectedTicket.category] || selectedTicket.category}</Text>
              <Text style={styles.mutedText}>{uiText(language, 'Status:', 'Статус:')} {statusLabels[selectedTicket.status] || selectedTicket.status}</Text>
              {isStaff && !!selectedTicket.email && <Text style={styles.mutedText}>{selectedTicket.email}</Text>}
            </View>
            <Text style={styles.mutedText}>#{String(selectedTicket.ticket_id).slice(0, 8)}</Text>
          </View>
          {isStaff && selectedTicket.status !== 'closed' && (
            <TouchableOpacity activeOpacity={0.86} style={styles.authSecondary} onPress={onCloseTicket} disabled={busy}>
              <Text style={styles.authSecondaryText}>{uiText(language, 'Close ticket', 'Закрыть обращение')}</Text>
            </TouchableOpacity>
          )}
          {(selectedTicket.messages || []).map((item: any) => (
            <View key={item.message_id} style={[styles.galleryCard, { marginTop: 9 }]}>
              <Text style={styles.eyebrow}>
                {item.sender_role === 'user' ? (uiText(language, 'YOU', 'ВЫ')) : (uiText(language, 'SUPPORT', 'ПОДДЕРЖКА'))}
              </Text>
              <Text style={styles.description}>{item.body}</Text>
              <Text style={styles.galleryDate}>
                {item.created_at ? new Date(item.created_at).toLocaleString('ru-RU') : ''}
              </Text>
              {(item.attachments || []).map((attachment: any) => (
                <TouchableOpacity activeOpacity={0.86}
                  key={attachment.attachment_id}
                  style={styles.authTextButton}
                  onPress={() => onOpenAttachment(attachment)}
                >
                  <Text style={styles.authLinkText}>↗ {attachment.file_name} · {uiText(language, 'Open / save', 'Открыть / сохранить')}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {selectedTicket.status === 'closed' ? (
            <Text style={styles.note}>{uiText(language, 'This ticket is closed. Create a new ticket if you still need help.', 'Обращение закрыто. Если проблема осталась, создайте новое обращение.')}</Text>
          ) : (
            <>
              <TextInput
                style={[styles.authInput, { minHeight: 90, textAlignVertical: 'top' }]}
                value={message}
                onChangeText={setMessage}
                placeholder={uiText(language, 'Write a reply...', 'Напишите ответ...')}
                placeholderTextColor="#687386"
                multiline
                editable={!busy}
              />
              <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={onChooseFiles} disabled={busy}>
                <Text style={styles.authLinkText}>{uiText(language, '＋ Attach images (up to 5)', '＋ Прикрепить изображения (до 5)')}</Text>
              </TouchableOpacity>
              {files.map((file, index) => (
                <View key={file.assetId || file.uri} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }}>
                  <Text style={styles.mutedText} numberOfLines={1}>{file.fileName || (uiText(language, 'Image', 'Изображение'))} · {file.fileSize ? (file.fileSize / 1024 / 1024).toFixed(1) + ' MB' : ''}</Text>
                  <TouchableOpacity activeOpacity={0.86} onPress={() => onRemoveFile(index)}>
                    <Text style={styles.deleteVideoText}>{uiText(language, 'Remove', 'Убрать')}</Text>
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity activeOpacity={0.86} style={[styles.authAction, busy && styles.disabledButton]} onPress={onSend} disabled={busy || (!message.trim() && files.length === 0)}>
                {busy ? <ActivityIndicator color={WHITE} /> : <Text style={styles.createButtonText}>{uiText(language, 'SEND REPLY', 'ОТПРАВИТЬ')}</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : isStaff ? (
        <View>
          <Text style={styles.sectionTitle}>{uiText(language, 'USER TICKETS', 'ОБРАЩЕНИЯ ПОЛЬЗОВАТЕЛЕЙ')}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 12 }}>
            {(['new', 'in_progress', 'closed'] as const).map((value) => (
              <TouchableOpacity activeOpacity={0.86}
                key={value}
                onPress={() => setFilter(value)}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: 9,
                  borderRadius: 9,
                  borderWidth: 1,
                  borderColor: filter === value ? BLUE : '#253147',
                  backgroundColor: filter === value ? '#142344' : PANEL,
                }}
              >
                <Text style={{ color: WHITE, fontSize: 14, fontWeight: '700' }}>{statusLabels[value]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onRefresh}>
            <Text style={styles.smallActionText}>{uiText(language, 'Refresh queue', 'Обновить очередь')}</Text>
          </TouchableOpacity>
          {loading && <ActivityIndicator color={BLUE} style={{ marginTop: 18 }} />}
          {!loading && tickets.length === 0 && <Text style={styles.note}>{uiText(language, 'No tickets in this category.', 'Обращений в этой категории нет.')}</Text>}
          {tickets.map((ticket) => (
            <TouchableOpacity activeOpacity={0.86} key={ticket.ticket_id} style={styles.packageCard} onPress={() => onOpen(ticket.ticket_id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.packageAmount}>{categoryLabels[ticket.category] || ticket.category}</Text>
                <Text style={styles.mutedText}>{ticket.email}</Text>
                <Text style={styles.mutedText} numberOfLines={2}>{ticket.description}</Text>
                <Text style={styles.galleryDate}>{ticket.created_at ? new Date(ticket.created_at).toLocaleString('ru-RU') : ''}</Text>
              </View>
              <Text style={styles.smallActionText}>{statusLabels[ticket.status] || ticket.status} ›</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View>
          <Text style={styles.sectionTitle}>{uiText(language, 'NEW SUPPORT TICKET', 'НОВОЕ ОБРАЩЕНИЕ')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 10 }}>
            {(['generation', 'payment', 'account', 'other'] as const).map((value) => (
              <TouchableOpacity activeOpacity={0.86}
                key={value}
                onPress={() => setCategory(value)}
                style={{
                  paddingVertical: 9,
                  paddingHorizontal: 12,
                  borderRadius: 9,
                  borderWidth: 1,
                  borderColor: category === value ? BLUE : '#253147',
                  backgroundColor: category === value ? '#142344' : PANEL,
                }}
              >
                <Text style={{ color: WHITE, fontSize: 14, fontWeight: '700' }}>{categoryLabels[value]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={[styles.authInput, { minHeight: 110, textAlignVertical: 'top' }]}
            value={description}
            onChangeText={setDescription}
            placeholder={uiText(language, 'Describe the issue in detail...', 'Опишите проблему подробно...')}
            placeholderTextColor="#687386"
            multiline
            editable={!busy}
          />
          <TouchableOpacity activeOpacity={0.86} style={styles.authTextButton} onPress={onChooseFiles} disabled={busy}>
            <Text style={styles.authLinkText}>{uiText(language, '＋ Attach images (up to 5)', '＋ Прикрепить изображения (до 5)')}</Text>
          </TouchableOpacity>
          {files.map((file, index) => (
            <View key={file.assetId || file.uri} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }}>
              <Text style={styles.mutedText} numberOfLines={1}>{file.fileName || (uiText(language, 'Image', 'Изображение'))} · {file.fileSize ? (file.fileSize / 1024 / 1024).toFixed(1) + ' MB' : ''}</Text>
              <TouchableOpacity activeOpacity={0.86} onPress={() => onRemoveFile(index)}>
                <Text style={styles.deleteVideoText}>{uiText(language, 'Remove', 'Убрать')}</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity activeOpacity={0.86} style={[styles.authAction, busy && styles.disabledButton]} onPress={onCreate} disabled={busy || description.trim().length < 5}>
            {busy ? <ActivityIndicator color={WHITE} /> : <Text style={styles.createButtonText}>{uiText(language, 'CREATE TICKET', 'СОЗДАТЬ ОБРАЩЕНИЕ')}</Text>}
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 25 }}>
            <Text style={styles.sectionTitle}>{uiText(language, 'MY TICKETS', 'МОИ ОБРАЩЕНИЯ')}</Text>
            <TouchableOpacity activeOpacity={0.86} style={styles.smallAction} onPress={onRefresh}>
              <Text style={styles.smallActionText}>{uiText(language, 'Refresh', 'Обновить')}</Text>
            </TouchableOpacity>
          </View>
          {loading && <ActivityIndicator color={BLUE} style={{ marginTop: 18 }} />}
          {!loading && tickets.length === 0 && <Text style={styles.note}>{uiText(language, 'No support tickets yet.', 'Обращений пока нет.')}</Text>}
          {tickets.map((ticket) => (
            <TouchableOpacity activeOpacity={0.86} key={ticket.ticket_id} style={styles.packageCard} onPress={() => onOpen(ticket.ticket_id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.packageAmount}>{categoryLabels[ticket.category] || ticket.category}</Text>
                <Text style={styles.mutedText} numberOfLines={2}>{ticket.description}</Text>
                <Text style={styles.galleryDate}>{ticket.created_at ? new Date(ticket.created_at).toLocaleDateString('ru-RU') : ''}</Text>
              </View>
              <Text style={styles.smallActionText}>{statusLabels[ticket.status] || ticket.status} ›</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function ImagePickerPreview({ uri }: { uri: string }) {
  return <Image source={{ uri }} style={styles.imagePreview} resizeMode="cover" />;
}

function GalleryVideoPlayer({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const videoViewRef = useRef<any>(null);

  return (
    <View style={styles.videoFrame}>
      <VideoView
        ref={videoViewRef}
        player={player}
        style={styles.videoPlayer}
        nativeControls={false}
        contentFit="contain"
      />
      <View style={styles.videoControls}>
        <TouchableOpacity activeOpacity={0.86}
          style={styles.videoControlButton}
          accessibilityLabel={isPlaying ? 'Приостановить видео' : 'Воспроизвести видео'}
          onPress={() => isPlaying ? player.pause() : player.play()}
        >
          <Text style={styles.videoControlText}>{isPlaying ? 'Ⅱ' : '▶'}</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.86}
          style={styles.videoControlButton}
          accessibilityLabel="Полноэкранный режим"
          onPress={() => videoViewRef.current?.enterFullscreen?.()}
        >
          <Text style={styles.videoControlText}>⛶</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}


const COSMIC_OVERRIDES = {
  container: { flex: 1, backgroundColor: '#030916' },
  ambientBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', backgroundColor: '#030916' },
  ambientGlowTop: { position: 'absolute', width: 520, height: 520, borderRadius: 260, top: -125, right: -270, backgroundColor: '#006BFF', opacity: 0.30 },
  ambientGlowBottom: { position: 'absolute', width: 500, height: 500, borderRadius: 250, bottom: -190, left: -255, backgroundColor: '#0059D6', opacity: 0.28 },
  ambientGlowCenter: { position: 'absolute', width: 390, height: 390, borderRadius: 195, top: '31%', left: '15%', backgroundColor: '#0648A5', opacity: 0.16 },
  ambientRing: { position: 'absolute', width: 520, height: 520, borderRadius: 260, borderWidth: 1.5, borderColor: 'rgba(36,137,255,0.18)', top: 145, right: -365, transform: [{ rotateX: '62deg' }] },
  ambientRingFar: { position: 'absolute', width: 640, height: 640, borderRadius: 320, borderWidth: 1, borderColor: 'rgba(16,108,255,0.14)', top: '26%', left: -420, transform: [{ rotateY: '58deg' }] },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, backgroundColor: 'rgba(3,9,22,0.97)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(56,143,255,0.20)' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  brandMarkLarge: { width: 46, height: 44, borderRadius: 13, borderWidth: 1.5, borderColor: '#48C7FF', backgroundColor: 'rgba(0,83,190,0.30)', alignItems: 'center', justifyContent: 'center', shadowColor: '#00AFFF', shadowOpacity: 0.8, shadowRadius: 16, elevation: 8 },
  brandMarkLargeText: { color: '#B5F0FF', fontSize: 18, fontWeight: '900', textShadowColor: '#008CFF', textShadowRadius: 10 },
  logo: { color: '#FFFFFF', fontSize: 19, lineHeight: 20, fontWeight: '900', fontFamily: 'sans-serif-rounded', letterSpacing: 0.2, textShadowColor: '#247DFF', textShadowRadius: 10 },
  logoSecond: { color: '#69BFFF', fontSize: 19, lineHeight: 20, fontWeight: '900', fontFamily: 'sans-serif-rounded', letterSpacing: 0.2, textShadowColor: '#247DFF', textShadowRadius: 10 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 0 },
  notificationButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: '#1E6AB5', backgroundColor: 'rgba(4,28,63,0.98)', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notificationIcon: { color: '#B5E5FF', fontSize: 23, fontWeight: '800' },
  notificationBadge: { position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: '#F02F4F', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  headerMenuButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: '#1E6AB5', backgroundColor: 'rgba(4,28,63,0.98)' },
  headerMenuIcon: { color: '#D7E9FF', fontSize: 24, lineHeight: 27 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 30 },
  creditsContent: { paddingBottom: 38 },
  referenceHero: { height: 246, minHeight: 246, marginTop: 5, marginBottom: 17, borderRadius: 26, overflow: 'hidden', backgroundColor: '#06152D', borderWidth: 1, borderColor: 'rgba(78,170,255,0.62)', justifyContent: 'flex-start', padding: 21, shadowColor: '#087BFF', shadowOpacity: 0.30, shadowRadius: 25, elevation: 10 },
  referenceHeroCopy: { width: '68%', marginTop: 18, zIndex: 2 },
  referenceHeroShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(1,8,22,0.08)' },
  referenceSkyGlow: { width: 285, height: 285, borderRadius: 143, top: -36, right: -35, backgroundColor: '#0755B8', opacity: 0.45, shadowColor: '#159DFF', shadowOpacity: 1, shadowRadius: 58, elevation: 18 },
  referenceMoon: { width: 142, height: 142, borderRadius: 71, top: 24, right: 34, backgroundColor: '#D9E8FF', shadowColor: '#70BFFF', shadowOpacity: 1, shadowRadius: 32, elevation: 16 },
  referenceMoonShade: { width: 148, height: 148, borderRadius: 74, top: 18, right: 12, backgroundColor: '#3B68A2', opacity: 0.22 },
  referenceMountainBack: { bottom: 8, left: -70, width: 360, height: 116, backgroundColor: '#142D55' },
  referenceMountainFront: { bottom: -4, right: -80, width: 340, height: 110, backgroundColor: '#07162E' },
  referenceRidgeLight: { bottom: 86, left: 5, width: 205, height: 2, backgroundColor: '#8CD9FF', opacity: 0.62, shadowColor: '#44B8FF', shadowOpacity: 1, shadowRadius: 9 },
  referencePerson: { top: 78, right: 92, width: 34, height: 82 },
  referencePersonHead: { width: 17, height: 19, borderRadius: 9, backgroundColor: '#071326', borderWidth: 1, borderColor: '#6A9FCB' },
  referencePersonBody: { width: 32, height: 49, marginTop: 2, borderRadius: 10, backgroundColor: '#071326', borderWidth: 1, borderColor: '#315A86' },
  referencePersonLegLeft: { position: 'absolute', top: 66, left: 8, width: 11, height: 47, backgroundColor: '#050D1D' },
  referencePersonLegRight: { position: 'absolute', top: 66, right: 8, width: 11, height: 47, backgroundColor: '#050D1D' },
  referenceHeroTitle: { color: '#FFFFFF', fontSize: 27, lineHeight: 32, fontWeight: '900', fontFamily: 'sans-serif-rounded', textShadowColor: '#168BFF', textShadowRadius: 16, marginBottom: 9 },
  referenceHeroCaption: { color: '#D4E8FF', fontSize: 15, lineHeight: 22, maxWidth: 205 },
  referenceCreateButton: { height: 62, width: '100%', marginBottom: 25, borderRadius: 20, borderWidth: 1.5, borderColor: '#80DFFF', backgroundColor: '#0877F9', shadowColor: '#008CFF', shadowOpacity: 0.68, shadowRadius: 22, elevation: 10 },
  referencePlay: { color: '#FFFFFF', fontSize: 23, marginRight: 12 },
  referenceCreateButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  featureSectionHeader: { marginTop: 5, marginBottom: 14 },
  featureSectionTitle: { color: '#EAF4FF', fontSize: 20, fontWeight: '900', letterSpacing: 0.2 },
  featureGrid: { rowGap: 13, marginBottom: 20 },
  featureCard: { width: '48.5%', minHeight: 104, paddingVertical: 16, paddingHorizontal: 12, borderRadius: 19, backgroundColor: 'rgba(7,26,58,0.96)', borderWidth: 1, borderColor: 'rgba(52,139,224,0.50)', shadowColor: '#087BFF', shadowOpacity: 0.16, shadowRadius: 14, elevation: 4 },
  featureIcon: { color: '#62D5FF', fontSize: 29, lineHeight: 34, textShadowColor: '#008CFF', textShadowRadius: 12 },
  featureText: { color: '#EAF4FF', fontSize: 15, lineHeight: 20, fontWeight: '800', textAlign: 'center' },
  composerBack: { alignSelf: 'flex-start', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 14, backgroundColor: 'rgba(6,25,57,0.98)', borderWidth: 1, borderColor: '#246BB0', marginBottom: 17 },
  composerBackText: { color: '#9FD4FF', fontSize: 14, fontWeight: '700' },
  hero: { position: 'relative', marginTop: 0, marginBottom: 17, padding: 24, minHeight: 140, justifyContent: 'center', borderRadius: 24, backgroundColor: 'rgba(4,27,68,0.96)', borderWidth: 1, borderColor: '#168BFF', overflow: 'hidden', shadowColor: '#007BFF', shadowOpacity: 0.56, shadowRadius: 30, shadowOffset: { width: 0, height: 8 }, elevation: 15, paddingHorizontal: 22 },
  heroGlow: { position: 'absolute', width: 310, height: 310, borderRadius: 155, top: -175, right: -60, backgroundColor: '#087BFF', opacity: 0.34 },
  heroOrbit: { position: 'absolute', width: 230, height: 230, borderRadius: 115, top: -130, right: -35, borderWidth: 1, borderColor: 'rgba(92,190,255,0.4)' },
  heroAccent: { position: 'absolute', top: 0, left: 22, width: 82, height: 3, borderRadius: 1, backgroundColor: '#5CCBFF', opacity: 0.9 },
  eyebrow: { color: '#67C8FF', fontSize: 13, fontWeight: '900', letterSpacing: 1.5 },
  heading: { color: WHITE, fontSize: 31, fontWeight: '900', fontFamily: 'sans-serif-rounded', lineHeight: 38, marginTop: 0, letterSpacing: -0.4, textShadowColor: '#148BFF', textShadowRadius: 22 },
  description: { color: '#B5CAE5', fontSize: 14, lineHeight: 22, marginTop: 8 },
  engineCard: { backgroundColor: 'rgba(6,24,53,0.98)', borderColor: 'rgba(55,135,218,0.55)', borderWidth: 1, borderRadius: 19, padding: 17, marginBottom: 23, shadowColor: '#087BFF', shadowOpacity: 0.15, shadowRadius: 16, elevation: 5 },
  engineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3DCBFF', marginRight: 12, shadowColor: '#28AFFF', shadowOpacity: 1, shadowRadius: 9, elevation: 5 },
  engineName: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  engineDescription: { color: '#9CB9D8', fontSize: 12, letterSpacing: 0.8, marginTop: 4 },
  engineStatus: { color: '#56C7FF', fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  sectionHeader: { marginTop: 17, marginBottom: 12 },
  sectionTitle: { color: '#E1EEFF', fontSize: 13, fontWeight: '900', letterSpacing: 1.25 },
  languageLabel: { color: '#56BFFF', fontSize: 12, fontWeight: '800', letterSpacing: 1.1 },
  prompt: { backgroundColor: 'rgba(3,14,33,0.99)', borderColor: 'rgba(54,143,226,0.72)', borderWidth: 1, borderRadius: 19, padding: 18, minHeight: 168, fontSize: 15, lineHeight: 23, color: '#F4F8FF' },
  characterCount: { color: '#8EAFD4', fontSize: 13, textAlign: 'right', marginTop: 9, marginBottom: 17 },
  optionRow: { flexDirection: 'row', gap: 12, marginBottom: 19 },
  option: { flex: 1, minHeight: 78, justifyContent: 'center', backgroundColor: 'rgba(6,22,49,0.98)', borderColor: '#245889', borderWidth: 1, borderRadius: 18, padding: 16, alignItems: 'center' },
  selectedOption: { borderColor: '#62D2FF', backgroundColor: 'rgba(7,82,171,0.48)', shadowColor: '#168BFF', shadowOpacity: 0.30, shadowRadius: 14, elevation: 6 },
  optionMain: { color: '#FFFFFF', fontWeight: '800', fontSize: 17 },
  optionSub: { color: '#A9C8EA', fontSize: 13, marginTop: 5 },
  activeText: { color: '#FFFFFF' },
  costCard: { backgroundColor: 'rgba(6,22,49,0.98)', borderColor: 'rgba(50,129,206,0.60)', borderWidth: 1, borderRadius: 18, padding: 18, marginBottom: 18 },
  costLabel: { color: '#78BFFF', fontSize: 13, letterSpacing: 1.1, fontWeight: '800' },
  costDescription: { color: '#FFFFFF', fontSize: 14, marginTop: 7 },
  costIcon: { color: '#51C9FF', fontSize: 24 },
  createButton: { backgroundColor: '#0877F9', borderColor: '#80DFFF', borderRadius: 20, minHeight: 66, shadowColor: '#008CFF', shadowOpacity: 0.65, shadowRadius: 24, elevation: 13 },
  createButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', fontFamily: 'sans-serif-medium', letterSpacing: 0.5 },
  disabledButton: { opacity: 0.55 },
  generationModalBackdrop: { flex: 1, backgroundColor: 'rgba(2,7,19,0.90)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  generationModalCard: { width: '100%', maxWidth: 360, borderRadius: 26, padding: 26, alignItems: 'center', backgroundColor: '#04142D', borderWidth: 1, borderColor: '#168BFF', shadowColor: '#008CFF', shadowOpacity: 0.65, shadowRadius: 30, elevation: 20 },
  generationModalMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#063B82', borderWidth: 1, borderColor: '#40C7FF', alignItems: 'center', justifyContent: 'center' },
  generationModalMarkText: { color: '#C8F5FF', fontSize: 15, fontWeight: '900' },
  generationModalTitle: { color: '#FFFFFF', fontSize: 20, lineHeight: 27, fontWeight: '900', textAlign: 'center', marginTop: 20 },
  generationModalDescription: { color: '#B5CAE5', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  generationModalHint: { color: '#78A5D2', fontSize: 13, textAlign: 'center', marginTop: 15 },
  statusCard: { backgroundColor: 'rgba(5,22,50,0.98)', borderColor: '#1D76C8', borderRadius: 19, padding: 18, shadowColor: '#087BFF', shadowOpacity: 0.2, shadowRadius: 15, elevation: 5 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusTitle: { color: '#83BFFF', fontSize: 13, fontWeight: '800', letterSpacing: 1.2 },
  statusValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', marginTop: 12 },
  statusSuccess: { color: '#42D992' },
  statusDescription: { color: '#B5CAE5', fontSize: 14, lineHeight: 20, marginTop: 6, height: 6, borderRadius: 4, backgroundColor: '#263147' },
  progressSegment: { flex: 1, height: 6, borderRadius: 4, backgroundColor: '#263147' },
  progressSegmentActive: { backgroundColor: '#159BFF', justifyContent: 'space-between', alignItems: 'center' },
  galleryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  screen: { flex: 1, paddingTop: 12 },
  screenTitle: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', marginTop: 5, marginBottom: 18, lineHeight: 36, fontFamily: 'sans-serif-rounded', textShadowColor: 'rgba(16,116,255,0.42)', textShadowRadius: 13 },
  galleryFilterButton: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,25,57,0.98)', borderWidth: 1, borderColor: 'rgba(69,157,225,0.66)' },
  galleryFilterIcon: { color: '#C8E8FF', fontSize: 23, lineHeight: 26 },
  galleryLimit: { color: '#A5C8EF', fontSize: 13, marginTop: 0, marginBottom: 8, textAlign: 'center' },
  storageTrack: { height: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: 'rgba(47,93,149,0.55)', marginTop: -2, marginBottom: 8 },
  storageProgress: { height: 5, borderRadius: 3, backgroundColor: '#079BFF', shadowColor: '#18B9FF', shadowOpacity: 0.9, shadowRadius: 8 },
  galleryTabs: { flexDirection: 'row', padding: 5, borderRadius: 16, backgroundColor: 'rgba(5,18,43,0.98)', borderWidth: 1, borderColor: '#245080', marginBottom: 12 },
  galleryTab: { flex: 1, minHeight: 43, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  galleryTabActive: { backgroundColor: '#096CE8', shadowColor: '#168BFF', shadowOpacity: 0.42, shadowRadius: 12, elevation: 5 },
  galleryTabText: { color: '#A7BBD8', fontSize: 14, fontWeight: '700' },
  galleryTabTextActive: { color: '#FFFFFF' },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', columnGap: 0 },
  galleryCard: { backgroundColor: 'rgba(5,19,43,0.98)', borderRadius: 18, padding: 9, marginTop: 12, borderWidth: 1, borderColor: 'rgba(53,132,208,0.60)', width: '48.5%', shadowColor: '#006DFF', shadowOpacity: 0.18, shadowRadius: 15, elevation: 5 },
  galleryPreview: { position: 'relative' },
  galleryDuration: { position: 'absolute', right: 7, bottom: 7, color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, fontSize: 12, fontWeight: '700' },
  galleryFavorite: { position: 'absolute', top: 8, right: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(1,8,22,0.88)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(104,194,255,0.75)' },
  galleryFavoriteText: { color: '#73CFFF', fontSize: 23, lineHeight: 27 },
  videoFrame: { width: '100%', height: 154, backgroundColor: '#020817', borderRadius: 13, overflow: 'hidden', justifyContent: 'center' },
  videoPlayer: { width: '100%', height: 154, backgroundColor: '#000000', borderRadius: 13 },
  videoControls: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(0,0,0,0.42)' },
  videoControlButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(17,24,39,0.88)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3978FF' },
  videoControlText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  galleryVideoTitle: { color: '#E7F3FF', fontSize: 13, fontWeight: '800', marginTop: 9 },
  galleryDate: { color: '#82A9D2', fontSize: 12, marginTop: 5, lineHeight: 17 },
  galleryPrompt: { color: '#C8DDF5', fontSize: 13, lineHeight: 19, marginTop: 9 },
  galleryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 8 },
  galleryActionButton: { borderWidth: 1, borderColor: 'rgba(70,171,255,0.65)', backgroundColor: 'rgba(0,101,226,0.20)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 11 },
  galleryActionText: { color: '#B9DEFF', fontSize: 13, fontWeight: '700' },
  deleteVideoButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 12, marginTop: 8, borderRadius: 11, backgroundColor: 'rgba(103,25,55,0.34)', borderWidth: 1, borderColor: 'rgba(255,112,143,0.35)' },
  deleteVideoText: { color: '#FF9EAD', fontSize: 13, fontWeight: '700' },
  jobId: { color: '#7795B9', fontSize: 12, marginTop: 10 },
  errorText: { color: '#FF9BAA', fontSize: 13, marginTop: 10, lineHeight: 19, backgroundColor: 'rgba(91,20,43,0.22)', borderColor: 'rgba(255,105,135,0.38)', borderWidth: 1, borderRadius: 12, padding: 11 },
  secondaryButton: { backgroundColor: 'rgba(5,43,91,0.96)', borderColor: '#168BFF', borderWidth: 1, borderRadius: 15, minHeight: 50, shadowColor: '#087BFF', shadowOpacity: 0.2, shadowRadius: 10, elevation: 3 },
  secondaryButtonText: { color: '#EAF5FF', fontWeight: '700', fontSize: 14 },
  resetButton: { paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  resetButtonText: { color: '#56BFFF', fontWeight: '800', fontSize: 14 },
  footerNote: { color: '#7FA2C9', fontSize: 11, textAlign: 'center', marginTop: 20, marginBottom: 12, letterSpacing: 1.2 },
  bottomNav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: 'rgba(1,7,19,0.99)', borderTopColor: '#1768B5', borderTopWidth: 1, paddingTop: 7, paddingBottom: 12, minHeight: 78, shadowColor: '#006DFF', shadowOpacity: 0.22, shadowRadius: 16, elevation: 14 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 0, minHeight: 58, paddingHorizontal: 4, paddingTop: 4, borderRadius: 13, borderWidth: 1, borderColor: 'transparent' },
  navItemActive: { backgroundColor: 'rgba(0,104,255,0.15)', borderWidth: 1, borderColor: 'rgba(48,169,255,0.45)', shadowColor: '#008CFF', shadowOpacity: 0.35, shadowRadius: 10, elevation: 4 },
  navIcon: { fontSize: 25, lineHeight: 30, color: '#4CAEFF' },
  navCoin: { width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: '#4CAEFF', backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 3 },
  navCoinInner: { width: '100%', height: '100%', borderRadius: 10, borderWidth: 1, borderColor: '#4CAEFF', alignItems: 'center', justifyContent: 'center' },
  navCoinMark: { color: '#4CAEFF', fontSize: 14, lineHeight: 16, fontWeight: '900' },
  navPerson: { width: 29, height: 31, alignItems: 'center', justifyContent: 'flex-end' },
  navPersonHead: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#4CAEFF', backgroundColor: 'transparent', marginBottom: 3 },
  navPersonBody: { width: 23, height: 14, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, borderWidth: 2, borderBottomWidth: 0, borderColor: '#4CAEFF', backgroundColor: 'transparent' },
  navLabel: { color: '#8CA8C9', fontSize: 12, lineHeight: 16, fontWeight: '700' },
  navLabelActive: { color: '#43B8FF', fontWeight: '900', textShadowColor: '#087BFF', textShadowRadius: 9 },
  modeSelector: { flexDirection: 'row', backgroundColor: 'rgba(4,15,36,0.96)', borderRadius: 17, padding: 5, marginBottom: 16, borderWidth: 1, borderColor: '#174D8A' },
  modeOption: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 13, alignItems: 'center', minHeight: 46, justifyContent: 'center' },
  modeOptionActive: { backgroundColor: '#075DE2', borderWidth: 1, borderColor: '#59C6FF', shadowColor: '#168BFF', shadowOpacity: 0.65, shadowRadius: 14, elevation: 7 },
  modeOptionText: { color: '#A9C8EA', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  modeOptionTextActive: { color: '#FFFFFF' },
  imageUploadCard: { backgroundColor: 'rgba(5,21,48,0.96)', borderRadius: 18, padding: 16, marginTop: 6, marginBottom: 15, borderWidth: 1, borderColor: '#1765B2' },
  chooseImageButton: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#299CFF', borderRadius: 16, minHeight: 132, alignItems: 'center', justifyContent: 'center', marginTop: 12, backgroundColor: 'rgba(3,17,41,0.96)' },
  chooseImageIcon: { color: '#67CFFF', fontSize: 30, fontWeight: '300' },
  chooseImageText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginTop: 5 },
  imageHint: { color: '#9CB9D8', fontSize: 13, marginTop: 5 },
  imagePreview: { width: '100%', height: 180, borderRadius: 13, marginTop: 12, backgroundColor: '#05080E' },
  imagePreviewPlaceholder: { height: 100, marginTop: 12, borderRadius: 10, backgroundColor: '#142B4A' },
  imageFileName: { color: '#9CB9D8', fontSize: 13, marginTop: 8 },
  removeImageButton: { alignSelf: 'flex-start', paddingVertical: 8, marginTop: 4 },
  removeImageText: { color: '#FF9EAD', fontSize: 13, fontWeight: '700' },
  languageCard: { backgroundColor: 'rgba(4,20,47,0.98)', borderRadius: 17, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#1765B2' },
  languageOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  languageOption: { flexGrow: 1, flexBasis: '28%', alignItems: 'center', paddingVertical: 10, borderRadius: 11, backgroundColor: '#0B1220', borderWidth: 1, borderColor: '#253147' },
  languageOptionActive: { borderColor: '#43B8FF', backgroundColor: '#142344' },
  languageOptionText: { color: '#A9C8EA', fontSize: 13, fontWeight: '700' },
  languageOptionTextActive: { color: '#FFFFFF' },
  emptyScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 300, paddingHorizontal: 15, padding: 22, borderRadius: 20, backgroundColor: 'rgba(4,18,42,0.88)', borderWidth: 1, borderColor: 'rgba(35,119,203,0.68)' },
  emptyIcon: { color: '#56BFFF', fontSize: 48, marginBottom: 15 },
  balanceCard: { backgroundColor: 'rgba(5,24,57,0.98)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(65,158,255,0.72)', padding: 25, marginTop: 8, marginBottom: 24, shadowColor: '#087BFF', shadowOpacity: 0.34, shadowRadius: 25, elevation: 10 },
  balanceLabel: { color: '#9BCBFF', fontSize: 14, letterSpacing: 1.5, fontWeight: '800' },
  bigBalance: { color: '#FFFFFF', fontSize: 42, fontWeight: '900', marginTop: 10, textShadowColor: '#147DFF', textShadowRadius: 17 },
  creditSymbol: { color: '#51C9FF', fontSize: 27 },
  mutedText: { color: '#9CB9D8', fontSize: 13, lineHeight: 20, marginTop: 7 },
  packageCard: { backgroundColor: 'rgba(6,23,51,0.99)', borderRadius: 18, padding: 15, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(55,133,208,0.62)', paddingHorizontal: 15, paddingVertical: 15, minHeight: 78, marginBottom: 11, shadowColor: '#006DFF', shadowOpacity: 0.13, shadowRadius: 12, elevation: 3 },
  packageIconWrap: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 12, backgroundColor: 'rgba(0,111,255,0.18)', borderWidth: 1, borderColor: 'rgba(68,176,255,0.55)' },
  packageIcon: { color: '#FFD45E', fontSize: 27, textShadowColor: '#FFB52E', textShadowRadius: 9 },
  packageDiamond: { color: '#53C9FF', textShadowColor: '#168BFF' },
  packageRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 5 },
  popularBadge: { backgroundColor: '#075DE2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#4CB9FF' },
  popularBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  packageAmount: { color: '#F3F8FF', fontSize: 17, fontWeight: '800' },
  packagePrice: { color: '#B7D7FF', fontSize: 14, marginTop: 3 },
  packagePriceHint: { color: '#7598C3', fontSize: 12, textAlign: 'right' },
  creditBalanceLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 15, marginBottom: 14, borderRadius: 17, backgroundColor: 'rgba(5,26,62,0.98)', borderWidth: 1, borderColor: 'rgba(59,137,218,0.68)', shadowColor: '#087BFF', shadowOpacity: 0.18, shadowRadius: 13, elevation: 4 },
  creditBalanceLabel: { color: '#A9C8EA', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  creditBalanceValue: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', textShadowColor: '#168BFF', textShadowRadius: 10 },
  creditIllustration: { height: 154, width: '100%', alignItems: 'center', justifyContent: 'center', marginTop: 0, marginBottom: 10, position: 'relative', borderRadius: 21, backgroundColor: 'rgba(4,22,54,0.92)', borderWidth: 1, borderColor: 'rgba(51,151,255,0.68)', overflow: 'hidden' },
  creditCoinStack: { position: 'absolute', bottom: 25, alignItems: 'center', justifyContent: 'flex-end' },
  creditStackLeft: { left: '22%' },
  creditStackCenter: { left: '42%', bottom: 29 },
  creditStackRight: { right: '18%' },
  creditCoin: { width: 65, height: 18, marginTop: -3, borderRadius: 33, backgroundColor: '#159BFF', borderWidth: 2, borderColor: '#83E2FF', alignItems: 'center', justifyContent: 'center', shadowColor: '#168BFF', shadowOpacity: 0.95, shadowRadius: 13, elevation: 8 },
  creditCoinInner: { width: 43, height: 10, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(210,244,255,0.85)', color: '#EAFBFF', textAlign: 'center', fontSize: 9, lineHeight: 9, overflow: 'hidden' },
  creditStarBadge: { position: 'absolute', right: '24%', bottom: 8, width: 46, height: 46, borderRadius: 23, backgroundColor: '#075DE2', borderWidth: 2, borderColor: '#83E2FF', color: '#EAFBFF', textAlign: 'center', textAlignVertical: 'center', fontSize: 26, overflow: 'hidden', shadowColor: '#168BFF', shadowOpacity: 1, shadowRadius: 16, elevation: 12 },
  creditIntro: { color: '#E2F1FF', fontSize: 15, lineHeight: 23, textAlign: 'center', marginHorizontal: 18, marginTop: 10, marginBottom: 16 },
  buyCreditsButton: { minHeight: 60, marginTop: 10, marginBottom: 14, borderRadius: 18, backgroundColor: '#086EFF', borderWidth: 1, borderColor: '#70D9FF', alignItems: 'center', justifyContent: 'center', shadowColor: '#008CFF', shadowOpacity: 0.58, shadowRadius: 18, elevation: 9, opacity: 0.72 },
  buyCreditsButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  buyCreditsHint: { color: '#C5E5FF', fontSize: 12, marginTop: 2 },
  creditNeverExpire: { textAlign: 'center', color: '#A9C8EA', fontSize: 13, marginTop: 8, marginBottom: 12 },
  creditsScreen: { paddingTop: 12 },
  creditsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 17 },
  creditsBackButton: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,24,58,0.92)', borderWidth: 1, borderColor: '#2467A8', marginRight: 10 },
  creditsBackText: { color: '#D7EBFF', fontSize: 32, lineHeight: 34, marginTop: -3 },
  creditsTitle: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', fontFamily: 'sans-serif-rounded', textShadowColor: 'rgba(16,116,255,0.48)', textShadowRadius: 13 },
  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  profileSettingsButton: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(69,157,225,0.66)', backgroundColor: 'rgba(5,26,59,0.96)' },
  profileSettingsIcon: { color: '#C5E5FF', fontSize: 22 },
  profileIdentity: { alignItems: 'center', paddingTop: 14, paddingBottom: 20, marginBottom: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(48,125,194,0.34)' },
  profileGuestAvatar: { width: 92, height: 92, borderRadius: 46, borderWidth: 2, borderColor: '#52CFFF', backgroundColor: 'rgba(0,91,180,0.18)', shadowColor: '#00AFFF', shadowOpacity: 0.68, shadowRadius: 22, elevation: 9 },
  profileGuestHead: { width: 26, height: 26, borderRadius: 13, borderColor: '#A6D8FF' },
  profileGuestBody: { width: 58, height: 33, borderColor: '#A6D8FF' },
  profileGuestName: { color: '#F3F7FF', fontSize: 20, fontWeight: '900', marginTop: 5 },
  profileGuestStatus: { color: '#A9BAD4', fontSize: 13, marginTop: 3 },
  profileVkButton: { height: 58, borderRadius: 18, backgroundColor: '#0877FF', borderWidth: 1, borderColor: '#75D7FF', marginBottom: 17, shadowColor: '#008CFF', shadowOpacity: 0.38, shadowRadius: 16, elevation: 8 },
  profileVkMark: { color: '#0877FF', backgroundColor: '#FFFFFF', borderRadius: 5, width: 23, height: 23, textAlign: 'center', textAlignVertical: 'center', fontWeight: '900', fontSize: 12, marginRight: 10, overflow: 'hidden' },
  profileVkText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  profileEmailButton: { minHeight: 48, marginTop: -5, marginBottom: 17, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(80,174,255,0.72)', backgroundColor: 'rgba(4,27,61,0.92)' },
  profileEmailButtonText: { color: '#A9D8FF', fontSize: 14, fontWeight: '700' },
  profileCard: { backgroundColor: 'rgba(5,24,57,0.98)', borderRadius: 21, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 17, borderWidth: 1, borderColor: 'rgba(65,158,255,0.62)', shadowColor: '#087BFF', shadowOpacity: 0.20, shadowRadius: 17, elevation: 6 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#0756B8', alignItems: 'center', justifyContent: 'center', marginRight: 13, borderWidth: 1, borderColor: '#55C9FF', shadowColor: '#168BFF', shadowOpacity: 0.6, shadowRadius: 13, elevation: 6 },
  profileMenuCard: { marginTop: 7, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(48,125,194,0.62)', backgroundColor: 'rgba(5,19,43,0.97)' },
  menuItem: { minHeight: 60, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: 'rgba(47,105,161,0.38)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 17, marginTop: 0, borderRadius: 0, borderWidth: 0, backgroundColor: 'transparent' },
  menuItemLast: { borderBottomWidth: 0 },
  menuIcon: { width: 28, color: '#82C9FF', fontSize: 19, textAlign: 'center', marginRight: 10 },
  menuNotificationBadge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: '#F02F4F', alignItems: 'center', justifyContent: 'center', marginLeft: 'auto', marginRight: 8 },
  menuNotificationText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  menuText: { color: '#E5F2FF', fontSize: 14, fontWeight: '600' },
  menuArrow: { color: '#54BFFF', fontSize: 25 },
  authBrandMark: { width: 78, height: 68, alignSelf: 'center', marginTop: 2, marginBottom: 8, borderRadius: 19, borderWidth: 2, borderColor: '#2ABEFF', backgroundColor: 'rgba(0,83,190,0.28)', alignItems: 'center', justifyContent: 'center', shadowColor: '#00AFFF', shadowOpacity: 0.9, shadowRadius: 24, elevation: 10 },
  authBrandMarkText: { color: '#9BEAFF', fontSize: 29, fontWeight: '900', textShadowColor: '#008CFF', textShadowRadius: 13 },
  authBrandTitle: { color: '#FFFFFF', fontSize: 25, lineHeight: 27, fontWeight: '900', textAlign: 'center', fontFamily: 'sans-serif-rounded', marginBottom: 18, textShadowColor: '#168BFF', textShadowRadius: 12 },
  authCard: { backgroundColor: 'rgba(5,21,48,0.99)', borderRadius: 21, padding: 19, marginBottom: 18, borderWidth: 1, borderColor: 'rgba(55,133,208,0.66)', shadowColor: '#087BFF', shadowOpacity: 0.18, shadowRadius: 18, elevation: 6 },
  authInput: { fontFamily: 'sans-serif', backgroundColor: 'rgba(2,12,29,0.99)', borderWidth: 1, borderColor: 'rgba(63,143,218,0.68)', borderRadius: 15, paddingHorizontal: 16, paddingVertical: 13, color: '#FFFFFF', fontSize: 16, marginTop: 12, minHeight: 56 },
  authAction: { backgroundColor: '#0877FF', borderRadius: 17, paddingHorizontal: 15, paddingVertical: 15, minHeight: 56, borderWidth: 1, borderColor: '#70D6FF', alignItems: 'center', justifyContent: 'center', marginTop: 14, shadowColor: '#008CFF', shadowOpacity: 0.5, shadowRadius: 18, elevation: 9 },
  authSecondary: { backgroundColor: 'rgba(5,28,62,0.98)', borderColor: 'rgba(57,155,226,0.76)', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  authSecondaryText: { color: '#EAF5FF', fontWeight: '700', fontSize: 14 },
  authTextButton: { paddingVertical: 13, alignItems: 'center' },
  authLinkText: { color: '#83C8FF', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  authNotice: { color: '#9DD7FF', fontSize: 14, lineHeight: 19, marginTop: 12, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,105,210,0.14)', borderWidth: 1, borderColor: 'rgba(58,160,255,0.35)' },
  smallAction: { backgroundColor: 'rgba(5,43,91,0.96)', paddingHorizontal: 14, paddingVertical: 9, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: '#168BFF', justifyContent: 'center', shadowColor: '#087BFF', shadowOpacity: 0.18, shadowRadius: 10, elevation: 3 },
  smallActionText: { color: '#EAF5FF', fontSize: 14, fontWeight: '700' },
  note: { color: '#9CB9D8', fontSize: 14, lineHeight: 22, marginTop: 20 },
  splashReferenceViewport: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', backgroundColor: '#020817' },
  introOverlay: { position: 'absolute', top: -48, right: 0, bottom: -52, left: 0, zIndex: 100, overflow: 'hidden', backgroundColor: '#010714', alignItems: 'center', justifyContent: 'center' },
  introStarField: { ...StyleSheet.absoluteFillObject },
  introStar: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: '#BDEBFF', shadowColor: '#3EAFFF', shadowOpacity: 0.95, shadowRadius: 5 },
  introWaterGlow: { position: 'absolute', left: '-22%', right: '-22%', bottom: '1%', height: '27%', borderTopWidth: 1, borderTopColor: 'rgba(71,183,255,0.32)', borderRadius: 260, backgroundColor: 'rgba(0,67,125,0.16)', transform: [{ scaleX: 1.15 }] },
  introNebulaTop: { position: 'absolute', width: 430, height: 430, borderRadius: 215, top: '7%', backgroundColor: '#064AC4', opacity: 0.28, shadowColor: '#078CFF', shadowOpacity: 1, shadowRadius: 80, elevation: 30 },
  introNebulaBottom: { position: 'absolute', width: 500, height: 260, borderRadius: 250, bottom: '4%', backgroundColor: '#006A9E', opacity: 0.19, shadowColor: '#00AFFF', shadowOpacity: 0.9, shadowRadius: 75, elevation: 25 },
  introOrbitOuter: { position: 'absolute', width: 292, height: 292, borderRadius: 146, borderWidth: 4, borderColor: 'rgba(46,174,255,0.92)', shadowColor: '#008DFF', shadowOpacity: 1, shadowRadius: 36, elevation: 25 },
  introOrbitInner: { position: 'absolute', width: 252, height: 252, borderRadius: 126, borderWidth: 2, borderColor: 'rgba(105,214,255,0.68)' },
  introLogoHalo: { position: 'absolute', width: 285, height: 235, borderRadius: 120, backgroundColor: '#0756C5', opacity: 0.34, shadowColor: '#2AAFFF', shadowOpacity: 1, shadowRadius: 65, elevation: 30 },
  introReelWrap: { position: 'absolute', top: '22%', width: 240, height: 190, alignItems: 'center', justifyContent: 'center' },
  introLogoPanel: { width: 224, height: 150, borderRadius: 0, borderWidth: 0, borderColor: 'transparent', backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', shadowColor: '#168CFF', shadowOpacity: 0.9, shadowRadius: 42, elevation: 22, transform: [{ rotate: '-8deg' }] },
  introReelPlay: { color: '#45C6FF', fontSize: 78, lineHeight: 88, fontWeight: '900', letterSpacing: -5, textShadowColor: '#006DFF', textShadowRadius: 30 },
  introAccentLine: { position: 'absolute', bottom: '21%', width: 116, height: 3, borderRadius: 2, backgroundColor: '#48C9FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 14, elevation: 10 },
  introHorizon: { position: 'absolute', left: 0, right: 0, top: '72%', height: 1, backgroundColor: 'rgba(69,145,255,0.18)' },
  introTitle: { position: 'absolute', bottom: '24%', color: '#FFFFFF', fontSize: 42, lineHeight: 45, fontWeight: '900', fontFamily: 'sans-serif-rounded', textAlign: 'center', letterSpacing: 0.4, textShadowColor: 'rgba(53,126,255,0.95)', textShadowRadius: 27, elevation: 12 },
  introTagline: { position: 'absolute', bottom: '10%', color: '#B8D9FF', fontSize: 17, lineHeight: 24, textAlign: 'center', fontWeight: '600', textShadowColor: '#168BFF', textShadowRadius: 14 },
  introProgressTrack: { position: 'absolute', bottom: '5%', width: '86%', maxWidth: 300, height: 4, borderRadius: 2, backgroundColor: 'rgba(62,122,190,0.34)', overflow: 'hidden' },
  introProgressFill: { width: '40%', height: 4, borderRadius: 2, backgroundColor: '#00B8FF', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
  ambientHorizon: { position: 'absolute', top: 112, left: 22, right: 22, height: 1, backgroundColor: 'rgba(73,158,255,0.12)' },
  ambientStarOne: { position: 'absolute', top: '18%', left: '17%', width: 4, height: 4, borderRadius: 2, backgroundColor: '#9BEAFF', shadowColor: '#39AFFF', shadowOpacity: 1, shadowRadius: 12, elevation: 8 },
  ambientStarTwo: { position: 'absolute', top: '43%', right: '13%', width: 3, height: 3, borderRadius: 2, backgroundColor: '#70C9FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 10, elevation: 7 },
  ambientStarThree: { position: 'absolute', bottom: '19%', left: '28%', width: 3, height: 3, borderRadius: 2, backgroundColor: '#A7E7FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 10, elevation: 7 },
  brandWordmark: { justifyContent: 'center', gap: 1 },
  notificationBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  avatarText: { color: '#EAF5FF', fontSize: 15, fontWeight: '900' },
  profileName: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  purchaseDisabled: { opacity: 0.5, borderWidth: 1, borderColor: '#28527D' },
  authDivider: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  version: { color: '#668BB7', fontSize: 12, letterSpacing: 1.3, textAlign: 'center', marginTop: 25 },
  ambientCloudOne: { position: 'absolute', width: 360, height: 190, borderRadius: 180, top: '14%', left: -180, backgroundColor: '#0756B8', opacity: 0.12, shadowColor: '#168BFF', shadowOpacity: 1, shadowRadius: 75, elevation: 20 },
  ambientCloudTwo: { position: 'absolute', width: 420, height: 230, borderRadius: 210, top: '39%', right: -235, backgroundColor: '#0077C8', opacity: 0.11, shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 80, elevation: 22 },
  ambientCloudThree: { position: 'absolute', width: 310, height: 180, borderRadius: 155, bottom: '13%', left: '8%', backgroundColor: '#153F9A', opacity: 0.13, shadowColor: '#176BFF', shadowOpacity: 1, shadowRadius: 65, elevation: 18 },
  ambientCloudFour: { position: 'absolute', width: 260, height: 140, borderRadius: 130, top: '65%', right: '5%', backgroundColor: '#006B9E', opacity: 0.10, shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 60, elevation: 16 },
  introOverlay: { position: 'absolute', top: -48, right: 0, bottom: -52, left: 0, zIndex: 100, overflow: 'hidden', backgroundColor: '#010714', alignItems: 'center', justifyContent: 'center' },
  introNebulaTop: { position: 'absolute', width: 460, height: 460, borderRadius: 230, top: '7%', alignSelf: 'center', backgroundColor: '#064AC4', opacity: 0.28, shadowColor: '#078CFF', shadowOpacity: 1, shadowRadius: 90, elevation: 28 },
  introNebulaBottom: { position: 'absolute', width: 500, height: 280, borderRadius: 250, bottom: '1%', alignSelf: 'center', backgroundColor: '#006A9E', opacity: 0.20, shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 85, elevation: 25 },
  introCloudLeft: { position: 'absolute', width: 290, height: 170, borderRadius: 145, top: '34%', left: -150, backgroundColor: '#064A9E', opacity: 0.22, shadowColor: '#078CFF', shadowOpacity: 1, shadowRadius: 65 },
  introCloudRight: { position: 'absolute', width: 320, height: 190, borderRadius: 160, top: '46%', right: -170, backgroundColor: '#006B9E', opacity: 0.18, shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 65 },
  introStarField: { ...StyleSheet.absoluteFillObject },
  introStar: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: '#BDEBFF', shadowColor: '#3EAFFF', shadowOpacity: 0.95, shadowRadius: 5 },
  splashArtwork: { width: 292, height: 300, alignItems: 'center', justifyContent: 'center', marginTop: -55 },
  splashFilmStrip: { position: 'absolute', width: 275, height: 66, borderRadius: 13, borderWidth: 8, borderColor: '#153B68', backgroundColor: 'rgba(4,22,48,0.92)', transform: [{ rotate: '-28deg' }], shadowColor: '#087BFF', shadowOpacity: 0.9, shadowRadius: 30, elevation: 18 },
  splashFilmPerforations: { flex: 1, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 3 },
  splashPerforation: { width: 11, height: 35, borderRadius: 3, backgroundColor: '#020A19', borderWidth: 1, borderColor: 'rgba(91,173,255,0.38)' },
  splashFilmTail: { position: 'absolute', width: 100, height: 38, right: 0, bottom: 27, borderRadius: 8, borderWidth: 7, borderColor: '#194A79', backgroundColor: 'rgba(4,22,48,0.88)', transform: [{ rotate: '28deg' }] },
  splashReelOuter: { width: 224, height: 224, borderRadius: 112, borderWidth: 14, borderColor: '#68CFFF', backgroundColor: '#071B3B', alignItems: 'center', justifyContent: 'center', shadowColor: '#168BFF', shadowOpacity: 1, shadowRadius: 36, elevation: 24 },
  splashReelInner: { width: 176, height: 176, borderRadius: 88, borderWidth: 8, borderColor: '#1D69A7', backgroundColor: '#0A2D5A', alignItems: 'center', justifyContent: 'center', shadowColor: '#00AFFF', shadowOpacity: 0.9, shadowRadius: 24 },
  splashReelHoleOne: { position: 'absolute', top: 13, width: 30, height: 30, borderRadius: 15, backgroundColor: '#020A1B', borderWidth: 2, borderColor: '#62C9FF' },
  splashReelHoleTwo: { position: 'absolute', bottom: 13, width: 30, height: 30, borderRadius: 15, backgroundColor: '#020A1B', borderWidth: 2, borderColor: '#62C9FF' },
  splashReelHoleThree: { position: 'absolute', left: 13, width: 30, height: 30, borderRadius: 15, backgroundColor: '#020A1B', borderWidth: 2, borderColor: '#62C9FF' },
  splashReelHoleFour: { position: 'absolute', right: 13, width: 30, height: 30, borderRadius: 15, backgroundColor: '#020A1B', borderWidth: 2, borderColor: '#62C9FF' },
  splashReelHub: { width: 92, height: 92, borderRadius: 46, borderWidth: 4, borderColor: '#B6EDFF', backgroundColor: '#04152D', alignItems: 'center', justifyContent: 'center', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 22 },
  splashPlayTriangle: { width: 0, height: 0, marginLeft: 8, borderTopWidth: 22, borderBottomWidth: 22, borderLeftWidth: 34, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#6AD9FF' },
  introTitle: { color: '#FFFFFF', fontSize: 40, lineHeight: 48, fontWeight: '900', fontFamily: 'sans-serif-rounded', textAlign: 'center', letterSpacing: 0.3, textShadowColor: 'rgba(53,126,255,0.95)', textShadowRadius: 28, marginTop: -2 },
  splashTagline: { color: '#B8D9FF', fontSize: 13, lineHeight: 19, textAlign: 'center', fontWeight: '800', letterSpacing: 3, marginTop: 13, textShadowColor: '#168BFF', textShadowRadius: 14 },
  introProgressTrack: { position: 'absolute', bottom: '6%', width: '84%', maxWidth: 320, height: 5, borderRadius: 3, backgroundColor: 'rgba(62,122,190,0.34)', overflow: 'hidden' },
  introProgressFill: { width: '72%', height: 5, borderRadius: 3, backgroundColor: '#00B8FF', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 9, elevation: 5 },
  featureSection: { marginTop: 4, marginBottom: 14 },
  featureSectionTitle: { color: '#F3F8FF', fontSize: 20, fontWeight: '900', marginBottom: 12, textShadowColor: 'rgba(25,132,255,0.40)', textShadowRadius: 10 },
  featureGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 11 },
  featureTile: { width: '48.5%', minHeight: 124, padding: 13, borderRadius: 18, backgroundColor: 'rgba(5,22,51,0.86)', borderWidth: 1, borderColor: 'rgba(57,132,210,0.55)', shadowColor: '#087BFF', shadowOpacity: 0.14, shadowRadius: 10, elevation: 3 },
  featureTileActive: { borderColor: '#72DFFF', backgroundColor: 'rgba(5,65,125,0.88)', shadowColor: '#00AFFF', shadowOpacity: 0.92, shadowRadius: 20, elevation: 10 },
  featureIconSquare: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(75,175,255,0.72)', backgroundColor: 'rgba(0,105,220,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  featureIconSquareActive: { borderColor: '#B7F1FF', backgroundColor: 'rgba(0,139,255,0.36)', shadowColor: '#00B8FF', shadowOpacity: 1, shadowRadius: 15, elevation: 8 },
  featureIcon: { color: '#82D9FF', fontSize: 22, fontWeight: '900', textShadowColor: '#168BFF', textShadowRadius: 9 },
  featureTitle: { color: '#F4FAFF', fontSize: 13, fontWeight: '900', lineHeight: 17 },
  featureSubtitle: { color: '#8FB5DC', fontSize: 10, lineHeight: 14, marginTop: 3 },
  galleryCard: { backgroundColor: 'rgba(5,19,43,0.98)', borderRadius: 20, padding: 8, marginTop: 12, borderWidth: 1, borderColor: 'rgba(53,132,208,0.60)', width: '48.5%', shadowColor: '#006DFF', shadowOpacity: 0.18, shadowRadius: 15, elevation: 5 },
  galleryPreview: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#020A18', borderWidth: 1, borderColor: 'rgba(65,152,224,0.42)', aspectRatio: 1 },
  videoFrame: { width: '100%', aspectRatio: 1, height: undefined, backgroundColor: '#020817', borderRadius: 16, overflow: 'hidden', justifyContent: 'center' },
  videoPlayer: { width: '100%', aspectRatio: 1, height: undefined, backgroundColor: '#000000', borderRadius: 16 },
  galleryDuration: { position: 'absolute', right: 7, bottom: 7, color: '#FFFFFF', backgroundColor: 'rgba(0,0,0,0.76)', paddingHorizontal: 7, paddingVertical: 4, borderRadius: 7, fontSize: 12, fontWeight: '800' },
  creditsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  creditsHeaderIcon: { color: '#FFD56B', fontSize: 25, marginRight: 11, textShadowColor: '#FFB52E', textShadowRadius: 13 },
  creditsTitle: { color: '#FFFFFF', fontSize: 29, fontWeight: '900', fontFamily: 'sans-serif-rounded', textShadowColor: 'rgba(16,116,255,0.48)', textShadowRadius: 13 },
  creditIllustration: { height: 245, marginBottom: 17, borderRadius: 23, backgroundColor: 'rgba(4,19,47,0.93)', borderWidth: 1, borderColor: 'rgba(255,197,81,0.42)', shadowColor: '#FFB52E', shadowOpacity: 0.17, shadowRadius: 22, elevation: 8 },
  creditIllustrationGlow: { width: 245, height: 155, borderRadius: 123, top: 4, backgroundColor: '#B87918', opacity: 0.18, shadowColor: '#FFC64D', shadowOpacity: 1, shadowRadius: 55, elevation: 16 },
  creditCoin: { width: 65, height: 18, marginTop: -3, borderRadius: 33, backgroundColor: '#B97A1B', borderWidth: 2, borderColor: '#FFE18A', shadowColor: '#FFC94F', shadowOpacity: 0.95, shadowRadius: 13, elevation: 8 },
  creditCoinInner: { borderColor: 'rgba(255,241,185,0.95)', color: '#FFF4C7' },
  creditStarBadge: { backgroundColor: '#8D5B12', borderColor: '#FFE18A', color: '#FFF4C7', shadowColor: '#FFC94F', shadowOpacity: 1, shadowRadius: 16, elevation: 12 },
  creditStackLeft: { bottom: 112 }, creditStackCenter: { bottom: 116 }, creditStackRight: { bottom: 108 },
  creditBalanceHero: { position: 'absolute', bottom: 15, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  creditBalanceHeroValue: { color: '#FFD66F', fontSize: 37, lineHeight: 42, fontWeight: '900', textShadowColor: '#FF9E22', textShadowRadius: 18 },
  creditBalanceHeroLabel: { color: '#FFE8AB', fontSize: 13, fontWeight: '800', letterSpacing: 1.5, marginTop: 1 },
  creditPackagesTitle: { color: '#F5FAFF', fontSize: 19, fontWeight: '900', marginBottom: 7, marginTop: 1, textShadowColor: 'rgba(25,132,255,0.38)', textShadowRadius: 9 },
  packageCard: { minHeight: 77, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,197,81,0.56)', backgroundColor: 'rgba(25,22,28,0.72)', shadowColor: '#FFB52E', shadowOpacity: 0.18, shadowRadius: 13, elevation: 4 },
  packageCardPopular: { borderColor: '#FFE08A', backgroundColor: 'rgba(71,48,14,0.42)', shadowColor: '#FFB52E', shadowOpacity: 0.68, shadowRadius: 19, elevation: 8 },
  packageIconWrap: { backgroundColor: 'rgba(171,111,24,0.20)', borderColor: 'rgba(255,210,104,0.62)' },
  packageIcon: { color: '#FFD66F', textShadowColor: '#FFB52E', textShadowRadius: 10 },
  packageAmount: { color: '#FFD66F', fontSize: 19, fontWeight: '900', textShadowColor: '#FFB52E', textShadowRadius: 9 },
  packagePrice: { color: '#D7BE88', fontSize: 11, marginTop: 3 },
  popularBadge: { backgroundColor: '#8D5B12', borderColor: '#FFE08A' },
  popularBadgeText: { color: '#FFF1C2' },
  buyCreditsButton: { minHeight: 60, borderRadius: 18, borderColor: '#FFE08A', backgroundColor: '#8B5A12', shadowColor: '#FFB52E', shadowOpacity: 0.42, shadowRadius: 18, elevation: 9, opacity: 0.78 },
  buyCreditsButtonText: { color: '#FFF7DD', fontSize: 16, fontWeight: '900' },
  buyCreditsHint: { color: '#F3DCA9', fontSize: 11, marginTop: 3 },
  profileIdentity: { alignItems: 'center', paddingTop: 8, paddingBottom: 19, marginBottom: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(48,125,194,0.34)' },
  profileGuestAvatar: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: '#62D7FF', backgroundColor: 'rgba(0,91,180,0.18)', shadowColor: '#00AFFF', shadowOpacity: 0.82, shadowRadius: 25, elevation: 12, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  profileAvatarHalo: { position: 'absolute', width: 118, height: 118, borderRadius: 59, borderWidth: 1, borderColor: 'rgba(70,190,255,0.38)', shadowColor: '#00AFFF', shadowOpacity: 0.9, shadowRadius: 23 },
  profileGuestHead: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#BCEBFF', backgroundColor: 'rgba(188,235,255,0.10)', marginBottom: 7 },
  profileGuestBody: { width: 58, height: 33, borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 2, borderBottomWidth: 0, borderColor: '#BCEBFF', backgroundColor: 'rgba(188,235,255,0.08)' },
  profileGuestName: { color: '#F3F7FF', fontSize: 18, fontWeight: '900', marginTop: 12, textAlign: 'center' },
  profileGuestStatus: { color: '#A9BAD4', fontSize: 12, marginTop: 4, textAlign: 'center' },
  profileHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  profileMenuCard: { marginTop: 9, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(48,125,194,0.62)', backgroundColor: 'rgba(5,19,43,0.97)' },
  navCreateIcon: { width: 27, height: 27, borderRadius: 8, borderWidth: 2, borderColor: '#68BFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#168BFF', shadowOpacity: 0.18, shadowRadius: 5 },
  navCreateTriangle: { width: 0, height: 0, marginLeft: 3, borderTopWidth: 7, borderBottomWidth: 7, borderLeftWidth: 10, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#68BFFF' },
  navGalleryIcon: { width: 27, height: 27, flexDirection: 'row', flexWrap: 'wrap', gap: 3, padding: 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#68BFFF', borderRadius: 7, backgroundColor: 'rgba(22,139,255,0.08)' },
  navGalleryCell: { width: 10, height: 10, borderRadius: 2, borderWidth: 1.8, borderColor: '#68BFFF', backgroundColor: 'rgba(22,139,255,0.10)' },
  navGlyphActive: { borderColor: '#B9F0FF', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 13, elevation: 8 },
  navCoinActive: { borderColor: '#FFE08A', shadowColor: '#FFB52E', shadowOpacity: 0.95, shadowRadius: 14, elevation: 8 },
  navCoinMark: { color: '#FFD66F', fontSize: 14, lineHeight: 16, fontWeight: '900' },
  notificationBell: { width: 22, height: 24, alignItems: 'center', justifyContent: 'center' },
  notificationBellDome: { width: 15, height: 15, borderTopLeftRadius: 9, borderTopRightRadius: 9, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, borderWidth: 1.8, borderColor: '#A9D9FF', borderBottomWidth: 0 },
  notificationBellBase: { width: 19, height: 2, borderRadius: 1, backgroundColor: '#A9D9FF', marginTop: -1 },
  notificationBellClapper: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#A9D9FF', marginTop: 1 },
};

const REFERENCE_POLISH = {
  container: { flex: 1, backgroundColor: '#010713' },
  content: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 16 },
  referenceHeroCopy: { position: 'absolute', top: 12, left: 14, width: '42%', marginTop: 0 },
  referenceHeroTitle: { color: '#FFFFFF', fontSize: 21, lineHeight: 22, fontWeight: '900', textShadowColor: '#087BFF', textShadowRadius: 10 },
  referenceHeroCaption: { color: '#C5E1FF', fontSize: 12, lineHeight: 16, marginTop: 5, fontWeight: '600', maxWidth: 132 },
  referenceLocalBadge: { position: 'absolute', right: 12, bottom: 13, minHeight: 52, maxWidth: '76%', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(56,181,255,0.82)', backgroundColor: 'rgba(1,12,31,0.88)', shadowColor: '#008CFF', shadowOpacity: 0.5, shadowRadius: 15, elevation: 7 },
  referenceLocalBadgeIcon: { color: '#69DBFF', fontSize: 25, marginRight: 9, textShadowColor: '#00AFFF', textShadowRadius: 12 },
  referenceLocalBadgeCopy: { flexShrink: 1 },
  referenceLocalBadgeTitle: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  referenceLocalBadgeText: { color: '#B7D5F4', fontSize: 11, marginTop: 2 },
  referenceCreateButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 58, width: '100%', marginTop: 0, marginBottom: 12, borderRadius: 30, borderWidth: 1.5, borderColor: '#64D7FF', backgroundColor: '#0877FF', shadowColor: '#008CFF', shadowOpacity: 0.9, shadowRadius: 22, elevation: 14 },
  referenceCreateButtonText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  composerBack: { alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 12, marginBottom: 18, borderRadius: 15, backgroundColor: 'rgba(4,23,54,0.98)', borderColor: 'rgba(66,158,255,0.72)' },
  modeSelector: { flexDirection: 'row', backgroundColor: 'rgba(3,15,36,0.98)', borderRadius: 16, padding: 5, marginBottom: 18, borderWidth: 1, borderColor: 'rgba(57,132,210,0.62)' },
  modeOption: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  modeOptionActive: { backgroundColor: '#086FEA', borderWidth: 1, borderColor: '#7BDFFF', shadowColor: '#168BFF', shadowOpacity: 0.34, shadowRadius: 12, elevation: 5 },
  prompt: { minHeight: 158, padding: 17, borderRadius: 17, backgroundColor: 'rgba(3,14,34,0.98)', borderColor: 'rgba(65,147,218,0.68)', borderWidth: 1, color: WHITE, fontFamily: 'sans-serif', fontSize: 15, lineHeight: 23 },
  imageUploadCard: { backgroundColor: 'rgba(5,23,52,0.98)', borderRadius: 18, padding: 16, marginTop: 5, marginBottom: 15, borderWidth: 1, borderColor: 'rgba(55,143,225,0.55)' },
  chooseImageButton: { borderWidth: 1, borderStyle: 'dashed', borderColor: '#42BFFF', borderRadius: 16, minHeight: 136, alignItems: 'center', justifyContent: 'center', marginTop: 12, backgroundColor: 'rgba(3,15,37,0.98)' },
  galleryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 13 },
  galleryTabActive: { backgroundColor: '#0877F9', shadowColor: '#168BFF', shadowOpacity: 0.52, shadowRadius: 14, elevation: 6 },
  creditsScreen: { paddingTop: 7 },
  creditsHeader: { marginBottom: 10 },
  creditIntro: { color: '#D9E9FF', fontSize: 12, lineHeight: 16, textAlign: 'center', marginHorizontal: 28, marginTop: 4, marginBottom: 10 },
  creditBalanceLine: { paddingVertical: 13, paddingHorizontal: 16, borderRadius: 15, backgroundColor: 'rgba(4,24,56,0.96)', borderWidth: 1, borderColor: 'rgba(58,146,222,0.56)', marginBottom: 10 },
  creditIllustrationGlow: { position: 'absolute', width: 220, height: 120, borderRadius: 110, top: 8, backgroundColor: '#087BFF', opacity: 0.22, shadowColor: '#21B9FF', shadowOpacity: 1, shadowRadius: 50, elevation: 16 },
  authLegalText: { color: '#91AAC8', fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 13, marginHorizontal: 4 },
  profileGuestStatusCaption: { color: '#6FA7DC', fontSize: 10, marginTop: 3, textAlign: 'center' },
  buyCreditsButton: { minHeight: 58, borderRadius: 17, borderColor: '#7BDFFF', backgroundColor: '#086FEA' },
  profileHeader: { marginBottom: 12 },
  profileIdentity: { paddingTop: 17, paddingBottom: 21, borderBottomColor: 'rgba(55,143,222,0.42)' },
  // Generation composer, status states and modal
  screen: { flex: 1, paddingTop: 12 },
  screenTitle: { color: '#F5FAFF', fontSize: 29, fontWeight: '900', marginTop: 8, marginBottom: 20, lineHeight: 35, textShadowColor: 'rgba(25,132,255,0.34)', textShadowRadius: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 18, marginBottom: 10 },
  sectionTitle: { color: '#BBD8F5', fontSize: 12, fontWeight: '900', letterSpacing: 1.35 },
  eyebrow: { color: '#59C8FF', fontSize: 11, fontWeight: '900', letterSpacing: 1.7 },
  languageLabel: { color: '#61C9FF', fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  engineCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, minHeight: 70, borderRadius: 18, padding: 15, backgroundColor: 'rgba(5,24,55,0.98)', borderColor: 'rgba(68,161,235,0.58)', marginBottom: 22, shadowColor: '#087BFF', shadowOpacity: 0.18, shadowRadius: 13, elevation: 4 },
  engineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#4EE2B0', marginRight: 12, shadowColor: '#4EE2B0', shadowOpacity: 0.8, shadowRadius: 8 },
  engineName: { color: '#F5FAFF', fontSize: 16, fontWeight: '900' },
  engineDescription: { color: '#91B7DE', fontSize: 10, letterSpacing: 0.9, marginTop: 5 },
  engineStatus: { color: '#69D6FF', fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  optionRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  option: { flex: 1, minHeight: 82, justifyContent: 'center', backgroundColor: 'rgba(4,19,45,0.98)', borderRadius: 17, borderWidth: 1, borderColor: 'rgba(57,127,196,0.62)', paddingVertical: 14, paddingHorizontal: 9, alignItems: 'center' },
  selectedOption: { borderColor: '#68D9FF', backgroundColor: 'rgba(5,91,184,0.40)', shadowColor: '#087BFF', shadowOpacity: 0.38, shadowRadius: 15, elevation: 6 },
  optionMain: { color: '#F4FAFF', fontWeight: '900', fontSize: 19 },
  optionSub: { color: '#9AB9D9', fontSize: 12, marginTop: 5, textAlign: 'center' },
  activeText: { color: '#FFFFFF', textShadowColor: '#26AFFF', textShadowRadius: 10 },
  characterCount: { color: '#83A8CE', fontSize: 12, textAlign: 'right', marginTop: 8, marginBottom: 14 },
  costCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 82, backgroundColor: 'rgba(5,24,56,0.98)', borderRadius: 18, padding: 17, marginTop: 14, marginBottom: 17, borderWidth: 1, borderColor: 'rgba(64,154,231,0.64)', shadowColor: '#087BFF', shadowOpacity: 0.2, shadowRadius: 14, elevation: 4 },
  costLabel: { color: '#8FB9E3', fontSize: 11, letterSpacing: 1.2, fontWeight: '900' },
  costDescription: { color: '#F2F8FF', fontSize: 14, marginTop: 7, lineHeight: 20, fontWeight: '700' },
  costIcon: { color: '#65D8FF', fontSize: 28, textShadowColor: '#168BFF', textShadowRadius: 12, marginLeft: 12 },
  costBalance: { minWidth: 70, alignItems: 'flex-end', justifyContent: 'center', paddingLeft: 9, marginLeft: 8, borderLeftWidth: 1, borderLeftColor: 'rgba(70,145,211,0.36)' },
  costBalanceLabel: { color: '#85B7E5', fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  costBalanceValue: { color: '#F4FAFF', fontSize: 16, fontWeight: '900', marginTop: 4 },
  createButton: { alignItems: 'center', justifyContent: 'center', minHeight: 62, paddingVertical: 19, paddingHorizontal: 18, marginTop: 5, borderWidth: 1, borderRadius: 19, backgroundColor: '#0877F9', borderColor: '#8AE5FF', shadowColor: '#008CFF', shadowOpacity: 0.62, shadowRadius: 22, elevation: 11 },
  disabledButton: { opacity: 0.48 },
  generationModalBackdrop: { flex: 1, backgroundColor: 'rgba(0,5,17,0.93)', alignItems: 'center', justifyContent: 'center', padding: 24, paddingHorizontal: 22 },
  generationModalCard: { width: '100%', maxWidth: 350, borderRadius: 27, padding: 26, alignItems: 'center', backgroundColor: 'rgba(4,20,48,0.99)', borderWidth: 1, borderColor: '#42BFFF', shadowColor: '#087BFF', shadowOpacity: 0.55, shadowRadius: 32, elevation: 22, paddingHorizontal: 24, paddingVertical: 30 },
  generationModalMark: { width: 70, height: 70, borderRadius: 22, backgroundColor: 'rgba(0,91,190,0.28)', borderWidth: 1, borderColor: '#71DFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#008CFF', shadowOpacity: 0.8, shadowRadius: 20, elevation: 10 },
  generationModalMarkText: { color: '#C7F5FF', fontSize: 19, fontWeight: '900', textShadowColor: '#008CFF', textShadowRadius: 12 },
  generationModalTitle: { color: '#FFFFFF', fontSize: 21, lineHeight: 28, fontWeight: '900', textAlign: 'center', marginTop: 19 },
  generationModalDescription: { color: '#C0D9F2', fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 11 },
  generationModalHint: { color: '#79B6E8', fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  statusCard: { backgroundColor: 'rgba(4,20,47,0.98)', borderWidth: 1, borderColor: 'rgba(64,163,238,0.66)', borderRadius: 20, padding: 18, marginTop: 20, shadowColor: '#087BFF', shadowOpacity: 0.2, shadowRadius: 15, elevation: 5 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(67,143,207,0.25)' },
  statusTitle: { color: '#8FB9E3', fontSize: 11, fontWeight: '900', letterSpacing: 1.3 },
  statusValue: { color: '#F5FAFF', fontSize: 19, fontWeight: '900', marginTop: 14, lineHeight: 26 },
  statusSuccess: { color: '#67E5B2' },
  statusDescription: { color: '#B4CDE8', fontSize: 14, lineHeight: 21, marginTop: 8, height: 6, borderRadius: 4, backgroundColor: '#263147' },
  errorText: { color: '#FF9BA9', fontSize: 13, marginTop: 11, lineHeight: 19, padding: 11, borderRadius: 12, backgroundColor: 'rgba(119,25,54,0.18)', borderWidth: 1, borderColor: 'rgba(255,103,133,0.36)' },
  jobId: { color: '#739BC4', fontSize: 11, marginTop: 12 },
  secondaryButton: { alignItems: 'center', justifyContent: 'center', minHeight: 54, backgroundColor: 'rgba(5,55,105,0.98)', borderColor: '#63CCFF', borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 16, marginTop: 15, shadowColor: '#168BFF', shadowOpacity: 0.24, shadowRadius: 12, elevation: 4 },
  secondaryButtonText: { color: '#F1FAFF', fontWeight: '800', fontSize: 14 },
  resetButton: { paddingVertical: 14, alignItems: 'center', marginTop: 9 },
  resetButtonText: { color: '#73D8FF', fontWeight: '900', fontSize: 14 },
  footerNote: { color: '#79A7D2', fontSize: 11, textAlign: 'center', marginTop: 24, marginBottom: 15, letterSpacing: 1.1 },
  // Gallery cards and compact layouts
  galleryTabText: { color: '#A8C6E5', fontSize: 13, fontWeight: '800' },
  galleryTabTextActive: { color: '#FFFFFF' },
  storageTrack: { height: 6, borderRadius: 4, backgroundColor: 'rgba(54,103,158,0.34)', overflow: 'hidden', marginBottom: 15 },
  storageProgress: { height: 6, borderRadius: 4, backgroundColor: '#55CEFF', shadowColor: '#168BFF', shadowOpacity: 0.8, shadowRadius: 8 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start' },
  galleryPreview: { borderRadius: 13, overflow: 'hidden', backgroundColor: '#020A18', borderWidth: 1, borderColor: 'rgba(65,152,224,0.38)' },
  galleryFavorite: { backgroundColor: 'rgba(1,12,31,0.88)', borderColor: 'rgba(91,187,255,0.7)', borderWidth: 1, borderRadius: 12 },
  galleryFavoriteText: { color: '#FFDA72', fontSize: 16 },
  galleryVideoTitle: { color: '#F2F8FF', fontSize: 13, fontWeight: '900', marginTop: 10, lineHeight: 18 },
  galleryDate: { color: '#83A9D0', fontSize: 11, marginTop: 5 },
  galleryPrompt: { color: '#B7CEE7', fontSize: 12, lineHeight: 17, marginTop: 8 },
  galleryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 5 },
  galleryActionButton: { borderWidth: 1, borderColor: 'rgba(70,166,255,0.55)', backgroundColor: 'rgba(6,43,91,0.78)', borderRadius: 9, paddingVertical: 7, paddingHorizontal: 8, minHeight: 34 },
  galleryActionText: { color: '#C8E7FF', fontSize: 11, fontWeight: '800' },
  galleryFilterButton: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,30,66,0.96)', borderWidth: 1, borderColor: 'rgba(73,166,238,0.58)' },
  galleryFilterIcon: { color: '#8EDCFF', fontSize: 20 },
  emptyScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 270, paddingHorizontal: 15, padding: 22, borderRadius: 20, backgroundColor: 'rgba(4,18,42,0.88)', borderWidth: 1, borderColor: 'rgba(35,119,203,0.68)' },
  emptyIcon: { color: '#56BFFF', fontSize: 48, marginBottom: 15 },
  // Credits, including transaction history states
  creditsContent: { paddingTop: 12, paddingHorizontal: 18, paddingBottom: 32 },
  creditHistorySection: { marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(63,137,202,0.35)' },
  creditHistoryHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  creditHistoryCount: { color: '#8BCFFF', fontSize: 12, fontWeight: '900', backgroundColor: 'rgba(14,93,169,0.30)', borderRadius: 10, overflow: 'hidden', paddingHorizontal: 9, paddingVertical: 4 },
  creditHistoryRow: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, marginBottom: 8, borderRadius: 15, backgroundColor: 'rgba(5,22,49,0.96)', borderWidth: 1, borderColor: 'rgba(58,132,199,0.46)' },
  creditHistoryIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,100,180,0.25)', borderWidth: 1, borderColor: 'rgba(73,178,239,0.48)' },
  creditHistoryIconText: { color: '#6BD8FF', fontSize: 16 },
  creditHistoryAmount: { fontSize: 14, fontWeight: '900', marginLeft: 6 },
  creditHistoryEmpty: { minHeight: 116, alignItems: 'center', justifyContent: 'center', padding: 18, borderRadius: 16, backgroundColor: 'rgba(4,18,42,0.72)', borderWidth: 1, borderColor: 'rgba(55,125,191,0.38)' },
  creditHistoryEmptyIcon: { color: '#5BCBFF', fontSize: 28, marginBottom: 7 },
  creditHistoryEmptyTitle: { color: '#E6F4FF', fontSize: 14, fontWeight: '800', marginBottom: 3 },
  // Profile, notifications and all secondary screens
  // Reference-matched cinematic composition refinements
  introOrbitOuter: { position: 'absolute', width: 354, height: 354, borderRadius: 177, borderWidth: 2.5, borderColor: 'rgba(70,177,255,0.82)', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 34, elevation: 20 },
  introOrbitInner: { position: 'absolute', width: 286, height: 286, borderRadius: 143, borderWidth: 2, borderColor: 'rgba(153,225,255,0.64)' },
  introEnergyRing: { position: 'absolute', borderRadius: 200, borderWidth: 1, borderColor: 'rgba(78,190,255,0.44)', shadowColor: '#28AFFF', shadowOpacity: 0.9, shadowRadius: 18, elevation: 10 },
  introEnergyRingOuter: { width: 390, height: 260, borderRadius: 200 },
  introEnergyRingInner: { width: 320, height: 220, borderRadius: 170, borderColor: 'rgba(138,220,255,0.30)' },
  introLogoHalo: { position: 'absolute', width: 310, height: 270, borderRadius: 150, backgroundColor: '#0756C5', opacity: 0.42, shadowColor: '#2AAFFF', shadowOpacity: 1, shadowRadius: 78, elevation: 30 },
  introReelWrap: { position: 'absolute', top: '24%', width: 260, height: 205, alignItems: 'center', justifyContent: 'center' },
  introLogoExtrusion: { position: 'absolute', top: 8, left: 0, right: 0, alignItems: 'center' },
  introLogoExtrusionText: { color: '#0756B7', fontSize: 66, lineHeight: 78, fontWeight: '900', letterSpacing: -4, textShadowColor: '#001B50', textShadowRadius: 5 },
  introLogoGlint: { position: 'absolute', top: 12, left: 22, right: 22, height: 2, backgroundColor: 'rgba(226,250,255,0.82)', shadowColor: '#FFFFFF', shadowOpacity: 1, shadowRadius: 10 },
  introBenefit: { color: '#91BCEB', fontSize: 9, fontWeight: '700', letterSpacing: 0.2 },
  introBenefitDivider: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#4FCBFF' },
  introProgressFill: { width: '48%', height: 3, borderRadius: 2, backgroundColor: '#00B8FF', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
  loginScreen: { flex: 1, minHeight: 520, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingTop: 22, paddingBottom: 34, overflow: 'hidden' },
  loginBrandLockup: { alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 12 },
  loginMarkOuter: { width: 112, height: 112, borderRadius: 56, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(93,207,255,0.88)', backgroundColor: 'rgba(3,36,91,0.58)', shadowColor: '#008CFF', shadowOpacity: 0.95, shadowRadius: 32, elevation: 18 },
  loginMarkInner: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#B0EDFF', backgroundColor: 'rgba(8,75,158,0.86)' },
  authBrandMarkText: { color: '#E3FAFF', fontSize: 26, fontWeight: '900', textShadowColor: '#00AFFF', textShadowRadius: 18 },
  authBrandTitle: { color: '#FFFFFF', fontSize: 35, lineHeight: 37, fontWeight: '900', textAlign: 'center', letterSpacing: 0.6, textShadowColor: '#087BFF', textShadowRadius: 20, marginTop: 14 },
  loginTagline: { color: '#C5E3FF', fontSize: 15, fontWeight: '600', letterSpacing: 0.3, marginBottom: 7, textAlign: 'center' },
  loginPcLabel: { color: '#65CFFF', fontSize: 10, fontWeight: '900', letterSpacing: 2.1, marginBottom: 27 },
  profileVkButton: { width: '100%', maxWidth: 350, height: 62, borderRadius: 18, marginBottom: 13 },
  profileEmailButton: { width: '100%', maxWidth: 350, minHeight: 56, borderRadius: 17, marginBottom: 13 },
  loginLegalText: { maxWidth: 330, textAlign: 'center', color: '#8EACD0', fontSize: 10, lineHeight: 15, marginTop: 4, marginBottom: 24 },
  loginBottomWave: { position: 'absolute', left: -32, right: -32, bottom: -12, height: 92, borderTopLeftRadius: 180, borderTopRightRadius: 180, backgroundColor: 'rgba(0,91,190,0.12)', borderTopColor: 'rgba(74,190,255,0.52)' },
  loginBottomWaveLine: { position: 'absolute', top: 0, left: 32, right: 32, height: 2, backgroundColor: '#38BFFF', shadowColor: '#008CFF', shadowOpacity: 1, shadowRadius: 18 },
  referenceSkyGlow: { position: 'absolute', width: 365, height: 365, borderRadius: 183, top: 42, right: -46, backgroundColor: '#0755B8', opacity: 0.72, shadowColor: '#159DFF', shadowOpacity: 1, shadowRadius: 72, elevation: 18 },
  referenceMoon: { position: 'absolute', width: 258, height: 258, borderRadius: 129, top: 55, right: 2, backgroundColor: '#E7F1FF', shadowOpacity: 1, shadowRadius: 42, elevation: 20 },
  referenceMoonShade: { position: 'absolute', width: 266, height: 266, borderRadius: 133, top: 48, right: -10, backgroundColor: '#3B68A2', opacity: 0.24 },
  referencePerson: { position: 'absolute', top: 78, right: 92, width: 34, height: 82, alignItems: 'center', transform: [{ scale: 1.28 }] },
  referenceMountainBack: { position: 'absolute', bottom: 0, left: -52, width: 450, height: 150, backgroundColor: '#142D55' },
  referenceMountainFront: { position: 'absolute', bottom: -10, right: -84, width: 390, height: 132, backgroundColor: '#07162E' },
  referenceRidgeLight: { position: 'absolute', bottom: 108, left: 0, width: 245, height: 2, backgroundColor: '#8CD9FF', opacity: 0.62, shadowColor: '#44B8FF', shadowOpacity: 1, shadowRadius: 9 },
  galleryTabs: { minHeight: 38, padding: 3, marginBottom: 10, borderRadius: 14, backgroundColor: 'rgba(5,23,54,0.92)', borderWidth: 1, borderColor: 'rgba(65,145,220,0.42)' },
  galleryTab: { minHeight: 32, paddingVertical: 6, borderRadius: 10 },
  galleryCard: { backgroundColor: 'rgba(5,20,46,0.72)', borderRadius: 12, padding: 3, marginTop: 5, borderWidth: 1, borderColor: 'rgba(54,130,205,0.42)', width: '48.5%' },
  videoFrame: { width: '100%', height: 112, backgroundColor: '#000000', borderRadius: 9, overflow: 'hidden', justifyContent: 'center' },
  videoPlayer: { width: '100%', height: 112, backgroundColor: '#000000', borderRadius: 9 },
  galleryDuration: { position: 'absolute', right: 6, bottom: 6, color: '#FFFFFF', backgroundColor: 'rgba(0,8,22,0.78)', paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, fontSize: 10, fontWeight: '800' },
  galleryLimit: { color: '#BBD9FA', fontSize: 12, marginTop: 2, marginBottom: 12, textAlign: 'center' },
  creditCoin: { width: 72, height: 22, marginTop: -4, backgroundColor: '#168EFF', borderColor: '#B0F0FF', shadowOpacity: 1, shadowRadius: 17, elevation: 12 },
  creditCoinInner: { width: 48, height: 13, lineHeight: 12, fontSize: 11, borderColor: '#E4FAFF' },
  creditStackLeft: { left: '18%' },
  creditStackCenter: { left: '41%', bottom: 30 },
  creditStackRight: { right: '15%' },
  packageCardPopular: { borderWidth: 2, borderColor: '#6BE0FF', backgroundColor: 'rgba(5,59,119,0.98)', shadowColor: '#008CFF', shadowOpacity: 0.72, shadowRadius: 20, elevation: 12, transform: [{ scale: 1.018 }] },
  creditsTitle: { fontSize: 28, letterSpacing: 0.3 },
  ambientRing: { position: 'absolute', width: 560, height: 560, borderRadius: 280, borderWidth: 1.5, borderColor: 'rgba(54,145,255,0.20)', top: 120, right: -390, transform: [{ rotateX: '62deg' }] },
  ambientRingFar: { position: 'absolute', width: 700, height: 700, borderRadius: 350, borderWidth: 1, borderColor: 'rgba(33,101,218,0.16)', top: '24%', left: -470, transform: [{ rotateY: '58deg' }] },
  ambientStarFour: { position: 'absolute', top: '27%', right: '31%', width: 2, height: 2, borderRadius: 1, backgroundColor: '#BDEBFF', shadowColor: '#3EAFFF', shadowOpacity: 1, shadowRadius: 8 },
  ambientStarFive: { position: 'absolute', top: '61%', left: '11%', width: 3, height: 3, borderRadius: 2, backgroundColor: '#8DDCFF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 9 },
  ambientStarSix: { position: 'absolute', top: '78%', right: '23%', width: 2, height: 2, borderRadius: 1, backgroundColor: '#BDEBFF', shadowColor: '#3EAFFF', shadowOpacity: 1, shadowRadius: 7 },
  ambientStarSeven: { position: 'absolute', top: '12%', right: '52%', width: 2, height: 2, borderRadius: 1, backgroundColor: '#8DDCFF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 8 },
  ambientStarEight: { position: 'absolute', bottom: '12%', left: '64%', width: 3, height: 3, borderRadius: 2, backgroundColor: '#A7E7FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 9 },
  introPcTag: { position: 'absolute', bottom: '8%', color: '#A8D5FF', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textAlign: 'center' },
  introBenefits: { position: 'absolute', bottom: '3.2%', width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  introProgressTrack: { position: 'absolute', bottom: '0.8%', width: '86%', maxWidth: 300, height: 4, borderRadius: 2, backgroundColor: 'rgba(62,122,190,0.34)', overflow: 'hidden' },
  referenceMoonOrbit: { position: 'absolute', width: 294, height: 294, borderRadius: 147, top: 38, right: -16, borderWidth: 1.2, borderColor: 'rgba(153,218,255,0.34)', transform: [{ rotate: '-18deg' }] },
  referenceStarA: { position: 'absolute', top: 52, left: '54%', width: 3, height: 3, borderRadius: 2, backgroundColor: '#C6EDFF', shadowColor: '#49BFFF', shadowOpacity: 1, shadowRadius: 10 },
  referenceStarB: { position: 'absolute', top: 136, left: '18%', width: 2, height: 2, borderRadius: 1, backgroundColor: '#A7E7FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 8 },
  referenceStarC: { position: 'absolute', top: 92, right: '9%', width: 2, height: 2, borderRadius: 1, backgroundColor: '#D7F4FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 9 },
  referenceHero: { width: '100%', maxWidth: 520, alignSelf: 'center', height: 246, minHeight: 246, marginTop: 5, marginBottom: 17, borderRadius: 26, overflow: 'hidden', backgroundColor: '#06152D', borderWidth: 1, borderColor: 'rgba(78,170,255,0.62)', justifyContent: 'flex-start', padding: 21, shadowColor: '#087BFF', shadowOpacity: 0.30, shadowRadius: 25, elevation: 10 },
  creditIllustration: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  packageCard: { backgroundColor: PANEL, borderRadius: 12, padding: 15, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#253147', width: '100%', maxWidth: 520, alignSelf: 'center' },
  profileGuestAvatar: { width: 82, height: 82, borderRadius: 41, borderWidth: 2, borderColor: '#6688B6', backgroundColor: 'rgba(80,119,177,0.16)', shadowColor: '#00AFFF', shadowOpacity: 0.25, shadowRadius: 12, elevation: 4 },
  profileGuestName: { color: '#F5FAFF', fontSize: 18, fontWeight: '900', marginTop: 12, maxWidth: '92%', textAlign: 'center' },
  profileGuestStatus: { color: '#7FE0BC', fontSize: 12, marginTop: 5, fontWeight: '800' },
  profileSettingsButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(4,25,57,0.96)', borderColor: 'rgba(71,165,231,0.62)' },
  profileVkText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  profileEmailButtonText: { color: '#B8DEFF', fontSize: 14, fontWeight: '800' },
  profileCard: { backgroundColor: 'rgba(4,21,49,0.96)', borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: 'rgba(58,143,214,0.62)' },
  profileMenuCard: { paddingHorizontal: 12, paddingVertical: 3, borderRadius: 18, backgroundColor: 'rgba(4,17,40,0.97)', borderWidth: 1, borderColor: 'rgba(52,131,204,0.54)' },
  menuItem: { minHeight: 44, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(54,111,169,0.22)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 9 },
  menuText: { color: '#E2F0FF', fontSize: 14, fontWeight: '700' },
  authCard: { backgroundColor: 'rgba(4,19,44,0.99)', borderRadius: 20, padding: 18, marginBottom: 18, borderWidth: 1, borderColor: 'rgba(65,148,221,0.62)' },
  authInput: { fontFamily: 'sans-serif', backgroundColor: 'rgba(1,11,28,0.99)', borderWidth: 1, borderColor: 'rgba(69,156,225,0.70)', borderRadius: 14, paddingHorizontal: 15, paddingVertical: 13, color: WHITE, fontSize: 15, marginTop: 11, minHeight: 54 },
  authAction: { backgroundColor: '#0877F9', borderRadius: 16, paddingHorizontal: 15, paddingVertical: 15, minHeight: 56, borderWidth: 1, borderColor: '#83E4FF', alignItems: 'center', justifyContent: 'center', marginTop: 14, shadowColor: '#167AFF', shadowOpacity: 0.22, shadowRadius: 12, elevation: 4 },
  authSecondary: { backgroundColor: 'rgba(5,32,70,0.98)', borderColor: 'rgba(67,160,239,0.68)', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, minHeight: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  authNotice: { color: '#A9DFFF', fontSize: 13, lineHeight: 19, marginTop: 12, padding: 11, borderRadius: 12, backgroundColor: 'rgba(0,105,210,0.14)', borderWidth: 1, borderColor: 'rgba(58,160,255,0.35)' },
  smallAction: { backgroundColor: 'rgba(5,43,91,0.96)', paddingHorizontal: 14, paddingVertical: 9, minHeight: 43, borderRadius: 13, borderWidth: 1, borderColor: '#399FFF', justifyContent: 'center' },
  note: { color: '#9CB9D8', fontSize: 13, lineHeight: 21, marginTop: 12 },
  // Shared app chrome and splash
  bottomNav: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: 'rgba(1,8,23,0.99)', borderTopWidth: 1, borderTopColor: 'rgba(43,87,137,0.32)', paddingTop: 5, paddingBottom: 7, minHeight: 61, shadowColor: '#006DFF', shadowOpacity: 0.16, shadowRadius: 16, elevation: 12 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0, minHeight: 58, paddingHorizontal: 2, paddingTop: 4, borderRadius: 13, borderWidth: 1, borderColor: 'transparent' },
  navItemActive: { backgroundColor: 'rgba(5,66,135,0.46)', borderWidth: 1, borderColor: 'rgba(74,177,255,0.55)' },
  navIcon: { fontSize: 25, lineHeight: 29, color: '#51BFFF' },
  navLabel: { color: '#A7C3E2', fontSize: 11, lineHeight: 14, fontWeight: '800' },
  navLabelActive: { color: '#63D8FF', fontWeight: '900', textShadowColor: '#087BFF', textShadowRadius: 8 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, backgroundColor: 'rgba(1,7,19,0.97)', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: 'rgba(48,145,255,0.25)' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 0 },
  brandMarkLarge: { width: 43, height: 43, borderRadius: 14, borderWidth: 1.5, borderColor: '#58D4FF', backgroundColor: 'rgba(0,83,190,0.34)', alignItems: 'center', justifyContent: 'center', shadowColor: '#00AFFF', shadowOpacity: 0.8, shadowRadius: 14, elevation: 8 },
  brandMarkLargeText: { color: '#B8F1FF', fontSize: 17, fontWeight: '900', textShadowColor: '#008CFF', textShadowRadius: 9 },
  logo: { color: '#FFFFFF', fontSize: 17, lineHeight: 18, fontWeight: '900', fontFamily: 'sans-serif-rounded', letterSpacing: 0.2, textShadowColor: '#247DFF', textShadowRadius: 9 },
  logoSecond: { color: '#8ECFFF', fontSize: 17, lineHeight: 18, fontWeight: '900', fontFamily: 'sans-serif-rounded', letterSpacing: 0.2, textShadowColor: '#247DFF', textShadowRadius: 9 },
  notificationButton: { width: 42, height: 42, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(72,166,236,0.62)', backgroundColor: 'rgba(5,29,65,0.98)', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  headerMenuButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(5,29,65,0.98)', borderWidth: 1, borderColor: 'rgba(72,166,236,0.62)', alignItems: 'center', justifyContent: 'center' },
  headerMenuIcon: { color: '#A9DFFF', fontSize: 21 },
  ambientBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', backgroundColor: '#010713' },
  ambientGlowTop: { position: 'absolute', width: 430, height: 430, borderRadius: 215, top: 20, right: -240, backgroundColor: '#075CEB', opacity: 0.22 },
  ambientGlowBottom: { position: 'absolute', width: 390, height: 390, borderRadius: 195, bottom: 20, left: -230, backgroundColor: '#007DBA', opacity: 0.19 },
  ambientGlowCenter: { position: 'absolute', width: 300, height: 300, borderRadius: 150, top: '34%', left: '24%', backgroundColor: '#103D9C', opacity: 0.10 },
  introOverlay: { position: 'absolute', top: -48, right: 0, bottom: -52, left: 0, zIndex: 100, overflow: 'hidden', backgroundColor: '#010713', alignItems: 'center', justifyContent: 'center' },
  introTitle: { position: 'absolute', bottom: '24%', color: WHITE, fontSize: 40, lineHeight: 44, fontWeight: '900', fontFamily: 'sans-serif-rounded', textAlign: 'center', letterSpacing: 0.4, textShadowColor: '#087BFF', textShadowRadius: 24, elevation: 12 },
  introTagline: { position: 'absolute', bottom: '10%', color: '#BBDFFF', fontSize: 16, lineHeight: 24, textAlign: 'center', fontWeight: '600', textShadowColor: '#168BFF', textShadowRadius: 14 },
  introLogoPanel: { width: 224, height: 150, alignItems: 'center', justifyContent: 'center', borderRadius: 28, borderWidth: 1, borderColor: 'rgba(90,202,255,0.66)', backgroundColor: 'rgba(4,24,58,0.58)' },
  introReelPlay: { color: '#B7F0FF', fontSize: 62, lineHeight: 90, fontWeight: '900', letterSpacing: -3, textShadowColor: '#006DFF', textShadowRadius: 34 },
};

const FINAL_UI_FIXES = {
  container: { flex: 1, backgroundColor: '#010713' },
  header: { paddingTop: 30, paddingBottom: 16 },
  brandRow: { marginTop: 4 },
  logo: { fontSize: 21, lineHeight: 23 },
  logoSecond: { fontSize: 21, lineHeight: 23 },
  content: { paddingHorizontal: 16, paddingTop: 22, paddingBottom: 30 },
  creditsContent: { paddingTop: 24, paddingBottom: 44 },
  screen: { flex: 1, paddingTop: 20, paddingBottom: 12 },
  bottomNav: { paddingTop: 9, paddingBottom: 24, minHeight: 88 },
  navItemActive: { shadowColor: '#00AFFF', shadowOpacity: 0.75, shadowRadius: 15, elevation: 9 },
  referenceHero: { height: 238, minHeight: 238, marginTop: 8, marginBottom: 16 },
  referenceHeroCopy: { top: 20, left: 18, width: '52%' },
  referenceHeroTitle: { fontSize: 24, lineHeight: 28, textShadowColor: '#087BFF', textShadowRadius: 16 },
  referenceHeroCaption: { fontSize: 13, lineHeight: 18, maxWidth: 170 },
  referenceCreateButton: { shadowOpacity: 0.62, shadowRadius: 18, elevation: 11 },
  featureSectionTitle: { textAlign: 'center', textShadowColor: '#168BFF', textShadowRadius: 12 },
  featureIconSquare: { shadowColor: '#168BFF', shadowOpacity: 0.48, shadowRadius: 11, elevation: 5 },
  featureIconSquareActive: { shadowOpacity: 1, shadowRadius: 17, elevation: 9 },
  creditsScreen: { paddingTop: 22 },
  creditsHeader: { justifyContent: 'center', marginBottom: 18 },
  creditsTitle: { fontSize: 26, lineHeight: 32, textAlign: 'center' },
  creditIllustration: { height: 168, marginBottom: 18, borderRadius: 20 },
  creditCoinReferenceCrop: { top: 8, width: 150, height: 92 },
  creditBalanceHero: { bottom: 9 },
  creditBalanceHeroValue: { fontSize: 29, lineHeight: 34 },
  creditPackagesTitle: { fontSize: 17, marginTop: 8, marginBottom: 9, textAlign: 'center' },
  packageCard: { minHeight: 76, paddingVertical: 12, paddingHorizontal: 15, marginTop: 10, borderRadius: 16 },
  packageAmount: { fontSize: 18, lineHeight: 23 },
  packagePrice: { fontSize: 16, marginTop: 4 },
  packageRight: { minWidth: 80, alignItems: 'flex-end', justifyContent: 'center' },
  packageIncluded: { color: '#91B8E2', fontSize: 11, marginTop: 4 },
  packagePriceHint: { display: 'none' },
  creditNeverExpire: { textAlign: 'center', marginTop: 18, marginBottom: 6 },
  buyCreditsButton: { marginTop: 12, shadowOpacity: 0.48, shadowRadius: 16 },
  profileHeader: { justifyContent: 'center', marginBottom: 16 },
  profileHeaderTitle: { textAlign: 'center' },
  profileIdentity: { paddingTop: 8, paddingBottom: 18, marginBottom: 14 },
  profileGuestAvatar: { width: 76, height: 76, borderRadius: 38, marginBottom: 8, alignItems: 'center', justifyContent: 'center' },
  profileGuestHead: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#A6D8FF', backgroundColor: 'rgba(166,216,255,0.10)', marginBottom: 4 },
  profileGuestBody: { width: 46, height: 26, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 2, borderBottomWidth: 0, borderColor: '#A6D8FF', backgroundColor: 'rgba(166,216,255,0.10)' },
  profileGuestName: { fontSize: 21, marginTop: 9 },
  profileGuestStatus: { fontSize: 13, lineHeight: 19, textAlign: 'center', paddingHorizontal: 16 },
  loginScreen: { paddingHorizontal: 4, paddingTop: 0, paddingBottom: 12 },
  loginTagline: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 18 },
  profileVkButton: { height: 54, borderRadius: 17, marginTop: 4, marginBottom: 12, shadowOpacity: 0.55, shadowRadius: 18, elevation: 10 },
  profileEmailButton: { minHeight: 48, marginBottom: 12 },
  loginLegalText: { fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 4, paddingHorizontal: 8 },
  profileMenuCard: { marginTop: 12 },
  menuItem: { minHeight: 56, paddingVertical: 13 },
  galleryTitleWrap: { position: 'relative', alignItems: 'center', justifyContent: 'center', minHeight: 58, marginBottom: 16, paddingTop: 4 },
  galleryTitle: { color: '#F5F8FF', fontSize: 25, lineHeight: 31, fontWeight: '900', textAlign: 'center', textShadowColor: 'rgba(35,145,255,0.65)', textShadowRadius: 13 },
  galleryTitleGlow: { position: 'absolute', bottom: 1, width: '72%', height: 2, borderRadius: 2, backgroundColor: '#21BFFF', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 12, elevation: 8 },
  galleryRefreshButton: { position: 'absolute', right: 2, top: 5, width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(80,174,255,0.55)', backgroundColor: 'rgba(4,27,61,0.86)' },
  galleryFilterIcon: { color: '#BDEBFF', fontSize: 22, fontWeight: '700' },
  introOverlay: { top: 0, bottom: 0 },
  ambientLightningOne: { position: 'absolute', top: '12%', right: '13%', width: 2, height: 150, backgroundColor: 'rgba(86,188,255,0.28)', transform: [{ rotate: '27deg' }], shadowColor: '#168BFF', shadowOpacity: 0.55, shadowRadius: 13, elevation: 5 },
  ambientLightningTwo: { position: 'absolute', top: '46%', left: '11%', width: 2, height: 112, backgroundColor: 'rgba(86,188,255,0.18)', transform: [{ rotate: '-31deg' }], shadowColor: '#168BFF', shadowOpacity: 0.42, shadowRadius: 10, elevation: 4 },
  ambientWaterReflection: { position: 'absolute', left: '8%', right: '8%', bottom: '3%', height: 74, borderTopWidth: 1, borderTopColor: 'rgba(63,173,255,0.16)', backgroundColor: 'rgba(0,88,155,0.045)', borderRadius: 90, shadowColor: '#008CFF', shadowOpacity: 0.22, shadowRadius: 24 },
  ambientWaterRippleOne: { position: 'absolute', bottom: '7%', left: '22%', width: '58%', height: 1, backgroundColor: 'rgba(90,194,255,0.16)', transform: [{ rotate: '-2deg' }] },
  ambientWaterRippleTwo: { position: 'absolute', bottom: '10%', left: '35%', width: '34%', height: 1, backgroundColor: 'rgba(90,194,255,0.12)', transform: [{ rotate: '2deg' }] },
  introProgressTrack: { position: 'absolute', bottom: '6%', width: '82%', maxWidth: 320, height: 5, borderRadius: 3, backgroundColor: 'rgba(62,122,190,0.35)', overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(104,190,255,0.28)' },
  introProgressFill: { height: 5, borderRadius: 3, backgroundColor: '#39D5FF', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 12, elevation: 6 },
};

const FINAL_UI_FIXES_V2 = {
 container:{flex:1,backgroundColor:'#010713',paddingTop:26},header:{paddingTop:10,paddingBottom:15,minHeight:86},brandRow:{marginTop:2},logo:{fontSize:22,lineHeight:25},logoSecond:{fontSize:22,lineHeight:25},
 content:{paddingHorizontal:16,paddingTop:20,paddingBottom:28},creditsContent:{paddingTop:16,paddingBottom:34},screen:{flex:1,paddingTop:12,paddingBottom:12},bottomNav:{paddingTop:8,paddingBottom:29,minHeight:98},navItem:{minHeight:64,paddingTop:5},navItemActive:{shadowColor:'#00AFFF',shadowOpacity:.82,shadowRadius:15,elevation:9},
 referenceHero:{height:226,minHeight:226,marginTop:6,marginBottom:15,overflow:'hidden'},referenceHeroCopy:{top:20,left:18,width:'57%'},referenceHeroTitle:{fontSize:25,lineHeight:29,textShadowColor:'#087BFF',textShadowRadius:16},referenceHeroCaption:{fontSize:13,lineHeight:18,maxWidth:180},referenceCreateGlow:{width:'100%',marginBottom:13,borderRadius:30,shadowColor:'#00AFFF',shadowOffset:{width:0,height:0},elevation:12},referenceCreateButton:{shadowOpacity:.42,shadowRadius:15,elevation:8,marginBottom:0},
 featureSectionTitle:{textAlign:'center',textShadowColor:'#168BFF',textShadowRadius:12},featureIconSquare:{shadowColor:'#168BFF',shadowOpacity:.58,shadowRadius:12,elevation:6},featureIconSquareActive:{shadowOpacity:1,shadowRadius:17,elevation:9},
 creditsScreen:{paddingTop:10,paddingBottom:18},creditsHeader:{position:'relative',alignItems:'center',justifyContent:'center',marginBottom:17,minHeight:48},creditsTitle:{color:'#F5F8FF',fontSize:27,lineHeight:34,fontWeight:'900',textAlign:'center',textShadowColor:'rgba(35,145,255,.68)',textShadowRadius:14},creditsTitleGlow:{position:'absolute',bottom:0,width:'72%',height:2,borderRadius:2,backgroundColor:'#21BFFF',shadowColor:'#00AFFF',shadowOpacity:1,shadowRadius:12,elevation:8},
 creditIllustration:{height:152,marginBottom:17,borderRadius:20,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:14,overflow:'hidden'},creditIllustrationGlow:{width:210,height:120,left:0,top:10,opacity:.16},creditCoinReferenceCrop:{position:'absolute',left:8,top:12,width:140,height:124,overflow:'hidden',borderRadius:16},creditBalanceHero:{position:'relative',bottom:0,left:0,right:0,flex:1,alignItems:'flex-end',justifyContent:'center',paddingRight:5},creditBalanceEyebrow:{color:'#A9C9E9',fontSize:10,fontWeight:'900',letterSpacing:1.1,marginBottom:4},creditBalanceHeroValue:{color:'#FFD66F',fontSize:30,lineHeight:36,fontWeight:'900',textShadowColor:'#FF9E22',textShadowRadius:14},creditBalanceHeroLabel:{color:'#FFF0C2',fontSize:12,fontWeight:'800',letterSpacing:.6,marginTop:1},
 creditPackagesTitle:{color:'#F5F8FF',fontSize:17,fontWeight:'900',marginTop:5,marginBottom:9,textAlign:'center'},packageCard:{minHeight:78,paddingVertical:11,paddingHorizontal:15,marginTop:9,borderRadius:16,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},packageAmount:{color:'#FFD66F',fontSize:19,lineHeight:24,fontWeight:'900',textShadowColor:'#FFB52E',textShadowRadius:8},packagePrice:{color:'#F6E2B5',fontSize:15,lineHeight:20,fontWeight:'800',marginTop:3},packageRight:{minWidth:90,alignItems:'flex-end',justifyContent:'center'},packageIncluded:{color:'#A9C4E2',fontSize:10,marginTop:4},packagePriceHint:{display:'none'},popularBadge:{paddingHorizontal:9,paddingVertical:5,borderRadius:9},popularBadgeText:{fontSize:10,fontWeight:'900'},creditNeverExpire:{color:'#BBD8F5',textAlign:'center',marginTop:16,marginBottom:7,fontSize:13},buyCreditsButton:{minHeight:66,marginTop:10,paddingVertical:12,paddingHorizontal:18,borderRadius:17,flexDirection:'column',alignItems:'center',justifyContent:'center',shadowOpacity:.48,shadowRadius:16,elevation:9},buyCreditsButtonText:{color:'#FFF',fontSize:17,lineHeight:22,fontWeight:'900',textAlign:'center'},buyCreditsHint:{color:'#E0F2FF',fontSize:11,lineHeight:15,marginTop:3,textAlign:'center'},
 profileHeader:{justifyContent:'center',marginBottom:8},profileIdentity:{alignItems:'center',paddingTop:7,paddingBottom:12,marginBottom:8,borderBottomWidth:1,borderBottomColor:'rgba(48,125,194,.34)'},profileGuestAvatar:{width:84,height:84,borderRadius:42,borderWidth:2,borderColor:'#62D7FF',backgroundColor:'rgba(0,91,180,.18)',shadowColor:'#00AFFF',shadowOpacity:.88,shadowRadius:22,elevation:11,alignItems:'center',justifyContent:'center',overflow:'visible'},profileAvatarHalo:{position:'absolute',width:100,height:100,borderRadius:50,borderWidth:1,borderColor:'rgba(70,190,255,.45)',shadowColor:'#00AFFF',shadowOpacity:.9,shadowRadius:20},profileGuestHead:{width:22,height:22,borderRadius:11,borderWidth:2,borderColor:'#BCEBFF',marginBottom:4},profileGuestBody:{width:48,height:27,borderTopLeftRadius:25,borderTopRightRadius:25,borderWidth:2,borderBottomWidth:0,borderColor:'#BCEBFF'},profileGuestName:{color:'#F3F7FF',fontSize:19,lineHeight:24,fontWeight:'900',marginTop:8,textAlign:'center'},profileGuestStatus:{color:'#A9BAD4',fontSize:12,lineHeight:17,marginTop:3,textAlign:'center',paddingHorizontal:16},
 profileMenuCard:{marginTop:11,borderRadius:17,overflow:'hidden',borderWidth:1,borderColor:'rgba(48,125,194,.62)',backgroundColor:'rgba(5,19,43,.94)'},loginScreen:{flexGrow:0,flexShrink:0,minHeight:0,paddingHorizontal:5,paddingTop:3,paddingBottom:8,marginTop:4},loginTagline:{color:'#C5DDF8',fontSize:13,lineHeight:19,textAlign:'center',marginBottom:12,paddingHorizontal:12},profileVkButton:{height:54,borderRadius:18,marginTop:3,marginBottom:8,shadowOpacity:.62,shadowRadius:18,elevation:10},profileEmailButton:{minHeight:42,marginBottom:8,borderRadius:14},
 profilePrivacyCard:{flexDirection:'row',alignItems:'center',gap:12,minHeight:58,paddingHorizontal:14,paddingVertical:10,borderRadius:15,borderWidth:1,borderColor:'rgba(57,132,210,.55)',backgroundColor:'rgba(5,25,56,.84)',marginTop:5},profilePrivacyIcon:{color:'#69CFFF',fontSize:26,fontWeight:'800',textShadowColor:'#168BFF',textShadowRadius:10},profilePrivacyTitle:{color:'#EAF5FF',fontSize:12,lineHeight:16,fontWeight:'800'},profilePrivacyText:{color:'#9DB9D8',fontSize:10,lineHeight:14,marginTop:2},loginLegalText:{color:'#8EA9C8',fontSize:9,lineHeight:13,textAlign:'center',marginTop:8,paddingHorizontal:9},
 menuItem:{minHeight:54,paddingVertical:12},menuIcon:{width:28,textAlign:'center',color:'#70C9FF',fontSize:18,marginRight:8},menuText:{color:'#E4F1FF',fontSize:13,fontWeight:'700'},menuArrow:{color:'#6EBEFF',fontSize:22},version:{color:'#668BB7',fontSize:10,letterSpacing:1.1,textAlign:'center',marginTop:18},
 ambientBackdrop:{...StyleSheet.absoluteFillObject,backgroundColor:'#020817'},ambientBackdropImage:{opacity:.48},ambientBackdropTint:{...StyleSheet.absoluteFillObject,backgroundColor:'rgba(1,7,18,.30)'},ambientLightningOne:{opacity:.14},ambientLightningTwo:{opacity:.10},ambientWaterReflection:{opacity:.08},
 introOverlay:{top:0,bottom:0},introProgressTrack:{position:'absolute',bottom:'6%',width:'82%',maxWidth:320,height:5,borderRadius:3,backgroundColor:'rgba(62,122,190,.35)',overflow:'hidden',borderWidth:1,borderColor:'rgba(104,190,255,.28)'},introProgressFill:{height:5,borderRadius:3,backgroundColor:'#39D5FF',shadowColor:'#00AFFF',shadowOpacity:1,shadowRadius:12,elevation:6}
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#030817' },
  ambientBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden', backgroundColor: '#030817' },
  ambientGlowTop: { position: 'absolute', width: 430, height: 430, borderRadius: 215, top: 20, right: -240, backgroundColor: '#075CEB', opacity: 0.26 },
  ambientGlowBottom: { position: 'absolute', width: 390, height: 390, borderRadius: 195, bottom: 20, left: -230, backgroundColor: '#007DBA', opacity: 0.23 },
  ambientGlowCenter: { position: 'absolute', width: 300, height: 300, borderRadius: 150, top: '34%', left: '24%', backgroundColor: '#103D9C', opacity: 0.12 },
  ambientRing: { position: 'absolute', width: 460, height: 460, borderRadius: 230, borderWidth: 1.5, borderColor: 'rgba(54,145,255,0.16)', top: 190, right: -330, transform: [{ rotateX: '62deg' }] },
  ambientRingFar: { position: 'absolute', width: 570, height: 570, borderRadius: 285, borderWidth: 1, borderColor: 'rgba(33,101,218,0.12)', top: '30%', left: -360, transform: [{ rotateY: '58deg' }] },
  ambientHorizon: { position: 'absolute', top: 112, left: 22, right: 22, height: 1, backgroundColor: 'rgba(73,158,255,0.18)' },
  ambientStarOne: { position: 'absolute', top: '18%', left: '17%', width: 4, height: 4, borderRadius: 2, backgroundColor: '#9BEAFF', shadowColor: '#39AFFF', shadowOpacity: 1, shadowRadius: 12, elevation: 8 },
  ambientStarTwo: { position: 'absolute', top: '43%', right: '13%', width: 3, height: 3, borderRadius: 2, backgroundColor: '#70C9FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 10, elevation: 7 },
  ambientStarThree: { position: 'absolute', bottom: '19%', left: '28%', width: 3, height: 3, borderRadius: 2, backgroundColor: '#A7E7FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 10, elevation: 7 },
  introOverlay: { position: 'absolute', top: -48, right: 0, bottom: -52, left: 0, zIndex: 100, overflow: 'hidden', backgroundColor: '#010714', alignItems: 'center', justifyContent: 'center' },
  introStarField: { ...StyleSheet.absoluteFillObject },
  introStar: { position: 'absolute', width: 2, height: 2, borderRadius: 1, backgroundColor: '#BDEBFF', shadowColor: '#3EAFFF', shadowOpacity: 0.95, shadowRadius: 5 },
  introWaterGlow: { position: 'absolute', left: '-22%', right: '-22%', bottom: '1%', height: '27%', borderTopWidth: 1, borderTopColor: 'rgba(71,183,255,0.32)', borderRadius: 260, backgroundColor: 'rgba(0,67,125,0.16)', transform: [{ scaleX: 1.15 }] },
  introNebulaTop: { position: 'absolute', width: 430, height: 430, borderRadius: 215, top: '7%', backgroundColor: '#064AC4', opacity: 0.28, shadowColor: '#078CFF', shadowOpacity: 1, shadowRadius: 80, elevation: 30 },
  introNebulaBottom: { position: 'absolute', width: 500, height: 260, borderRadius: 250, bottom: '4%', backgroundColor: '#006A9E', opacity: 0.19, shadowColor: '#00AFFF', shadowOpacity: 0.9, shadowRadius: 75, elevation: 25 },
  introOrbitOuter: { position: 'absolute', width: 330, height: 330, borderRadius: 165, borderWidth: 2, borderColor: 'rgba(70,177,255,0.62)', shadowColor: '#168CFF', shadowOpacity: 0.95, shadowRadius: 24, elevation: 16 },
  introOrbitInner: { position: 'absolute', width: 265, height: 265, borderRadius: 132, borderWidth: 1.5, borderColor: 'rgba(129,218,255,0.42)' },
  introLogoHalo: { position: 'absolute', width: 285, height: 235, borderRadius: 120, backgroundColor: '#0756C5', opacity: 0.34, shadowColor: '#2AAFFF', shadowOpacity: 1, shadowRadius: 65, elevation: 30 },
  introLogoImage: { width: 270, height: 205 },
  introReelWrap: { position: 'absolute', top: '26%', width: 245, height: 175, alignItems: 'center', justifyContent: 'center' },
  introFilmStrip: { position: 'absolute', top: 35, left: -15, width: 340, height: 78, borderWidth: 8, borderColor: '#168CFF', borderRadius: 12, backgroundColor: 'rgba(3,22,58,0.88)', transform: [{ rotate: '-25deg' }], shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 22, elevation: 14, overflow: 'hidden' },
  introFilmRailTop: { position: 'absolute', top: 1, left: 7, right: 7, height: 9, flexDirection: 'row', justifyContent: 'space-between' },
  introFilmRailBottom: { position: 'absolute', bottom: 1, left: 7, right: 7, height: 9, flexDirection: 'row', justifyContent: 'space-between' },
  introFilmPerforation: { width: 12, height: 7, borderRadius: 2, backgroundColor: '#8BDFFF', opacity: 0.9 },
  introReelOuter: { width: 248, height: 248, borderRadius: 124, borderWidth: 13, borderColor: '#56C9FF', backgroundColor: '#061B43', alignItems: 'center', justifyContent: 'center', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 28, elevation: 22 },
  introReelHoleTop: { position: 'absolute', top: 20, width: 58, height: 76, borderRadius: 32, backgroundColor: '#020B20', borderWidth: 2, borderColor: '#1B83E8' },
  introReelHoleLeft: { position: 'absolute', left: 19, top: 73, width: 75, height: 58, borderRadius: 32, backgroundColor: '#020B20', borderWidth: 2, borderColor: '#1B83E8' },
  introReelHoleRight: { position: 'absolute', right: 19, top: 73, width: 75, height: 58, borderRadius: 32, backgroundColor: '#020B20', borderWidth: 2, borderColor: '#1B83E8' },
  introReelHoleBottomLeft: { position: 'absolute', left: 45, bottom: 20, width: 58, height: 76, borderRadius: 32, backgroundColor: '#020B20', borderWidth: 2, borderColor: '#1B83E8', transform: [{ rotate: '42deg' }] },
  introReelHoleBottomRight: { position: 'absolute', right: 45, bottom: 20, width: 58, height: 76, borderRadius: 32, backgroundColor: '#020B20', borderWidth: 2, borderColor: '#1B83E8', transform: [{ rotate: '-42deg' }] },
  introReelHub: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#06265A', borderWidth: 4, borderColor: '#65DFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#00B8FF', shadowOpacity: 1, shadowRadius: 18, elevation: 14 },
  introReelPlay: { color: '#43BFFF', fontSize: 82, lineHeight: 90, fontWeight: '900', letterSpacing: -5, textShadowColor: '#006DFF', textShadowRadius: 34 },
  introAccentLine: { position: 'absolute', bottom: '21%', width: 116, height: 3, borderRadius: 2, backgroundColor: '#48C9FF', shadowColor: '#168CFF', shadowOpacity: 1, shadowRadius: 14, elevation: 10 },
  introGlowLarge: { position: 'absolute', width: 430, height: 430, borderRadius: 215, backgroundColor: '#123A83', opacity: 0.42, top: '18%', alignSelf: 'center', transform: [{ scaleX: 1.12 }] },
  introGlowSmall: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: '#1765C8', opacity: 0.24, top: '31%', alignSelf: 'center' },
  introGlowLower: { position: 'absolute', width: 460, height: 210, borderRadius: 230, backgroundColor: '#07558B', opacity: 0.19, bottom: '10%', alignSelf: 'center' },
  introTopLine: { position: 'absolute', top: '12%', width: 64, height: 3, borderRadius: 2, backgroundColor: '#54B8FF', opacity: 0.95, shadowColor: '#168CFF', shadowOpacity: 0.9, shadowRadius: 12, elevation: 8 },
  introBeamLeft: { position: 'absolute', top: '18%', left: '-20%', width: '78%', height: 1, backgroundColor: 'rgba(76,159,255,0.36)', transform: [{ rotate: '24deg' }] },
  introBeamRight: { position: 'absolute', top: '24%', right: '-18%', width: '72%', height: 1, backgroundColor: 'rgba(80,196,255,0.25)', transform: [{ rotate: '-27deg' }] },
  introHorizon: { position: 'absolute', left: 0, right: 0, top: '72%', height: 1, backgroundColor: 'rgba(69,145,255,0.18)' },
  introTitle: { position: 'absolute', bottom: '24%', color: WHITE, fontSize: 42, lineHeight: 45, fontWeight: '900', fontFamily: 'sans-serif-rounded', textAlign: 'center', letterSpacing: 0.4, textShadowColor: 'rgba(53,126,255,0.95)', textShadowRadius: 27, elevation: 12 },
  introTagline: { position: 'absolute', bottom: '10%', color: '#B8D9FF', fontSize: 17, lineHeight: 24, textAlign: 'center', fontWeight: '600', textShadowColor: '#168BFF', textShadowRadius: 14 },
  introProgressTrack: { position: 'absolute', bottom: '5%', width: '86%', maxWidth: 300, height: 4, borderRadius: 2, backgroundColor: 'rgba(62,122,190,0.34)', overflow: 'hidden' },
  introProgressFill: { width: '40%', height: 4, borderRadius: 2, backgroundColor: '#00B8FF', shadowColor: '#00AFFF', shadowOpacity: 1, shadowRadius: 8, elevation: 4 },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    backgroundColor: 'rgba(8,11,20,0.72)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1B2434',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 0 },
  brandMarkLarge: { width: 45, height: 42, borderRadius: 11, borderWidth: 1.5, borderColor: '#2ABEFF', backgroundColor: 'rgba(0,83,190,0.34)', alignItems: 'center', justifyContent: 'center', shadowColor: '#00AFFF', shadowOpacity: 0.9, shadowRadius: 15, elevation: 8 },
  brandMarkLargeText: { color: '#9BEAFF', fontSize: 18, fontWeight: '900', textShadowColor: '#008CFF', textShadowRadius: 9 },
  brandWordmark: { justifyContent: 'center' },
  brandMark: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#102B5D', borderWidth: 1, borderColor: '#28B9FF', alignItems: 'center', justifyContent: 'center', shadowColor: '#087CFF', shadowOpacity: 0.8, shadowRadius: 9, elevation: 6 },
  brandMarkText: { color: '#7BE8FF', fontSize: 14, fontWeight: '900' },
  logo: { color: WHITE, fontSize: 18, lineHeight: 19, fontWeight: '900', fontFamily: 'sans-serif-rounded', letterSpacing: 0.2, textShadowColor: '#247DFF', textShadowRadius: 9 },
  logoSecond: { color: '#8DBBFF', fontSize: 18, lineHeight: 19, fontWeight: '900', fontFamily: 'sans-serif-rounded', letterSpacing: 0.2, textShadowColor: '#247DFF', textShadowRadius: 9 },
  logoBlue: { color: BLUE },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 0 },
  notificationButton: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, borderColor: '#263B5D', backgroundColor: '#101B30', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  notificationIcon: { color: '#9CCBFF', fontSize: 23, fontWeight: '800' },
  notificationBadge: { position: 'absolute', top: -4, right: -4, minWidth: 17, height: 17, borderRadius: 9, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  notificationBadgeText: { color: WHITE, fontSize: 14, fontWeight: '800' },
  headerBalance: {
    backgroundColor: PANEL,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#253147',
    marginTop: 8,
  },
  headerBalanceLabel: { color: MUTED, fontSize: 14, letterSpacing: 1.5, fontWeight: '700' },
  headerBalanceValue: { color: WHITE, fontSize: 17, fontWeight: '900', marginTop: 4 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 30, paddingBottom: 42 },
  hero: { position: 'relative', marginTop: 4, marginBottom: 18, padding: 24, minHeight: 116, justifyContent: 'center', borderRadius: 25, backgroundColor: 'rgba(8,28,64,0.92)', borderWidth: 1, borderColor: '#2878D7', overflow: 'hidden', shadowColor: '#126BFF', shadowOpacity: 0.42, shadowRadius: 30, shadowOffset: { width: 0, height: 8 }, elevation: 12 },
  heroGlow: { position: 'absolute', width: 250, height: 250, borderRadius: 125, top: -145, right: -65, backgroundColor: '#1C5FC0', opacity: 0.24 },
  heroOrbit: { position: 'absolute', width: 190, height: 190, borderRadius: 95, top: -112, right: -32, borderWidth: 1, borderColor: 'rgba(103,174,255,0.22)' },
  heroAccent: { position: 'absolute', top: 0, left: 20, width: 58, height: 2, borderRadius: 1, backgroundColor: '#53B8FF', opacity: 0.9 },
  eyebrow: { color: BLUE, fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  heading: { color: WHITE, fontSize: 34, fontWeight: '900', fontFamily: 'sans-serif-rounded', lineHeight: 42, marginTop: 0, letterSpacing: -0.4, textShadowColor: '#3A9DFF', textShadowRadius: 18 },
  description: { color: MUTED, fontSize: 15, lineHeight: 23, marginTop: 13 },
  engineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#101B30',
    borderColor: '#263D65',
    borderWidth: 1,
    borderRadius: 14,
    padding: 15,
    marginBottom: 27,
  },
  engineDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#4B91FF', marginRight: 12 },
  engineName: { color: WHITE, fontSize: 14, fontWeight: '800' },
  engineDescription: { color: MUTED, fontSize: 14, letterSpacing: 1.1, marginTop: 4 },
  engineStatus: { color: BLUE, fontSize: 14, fontWeight: '900', letterSpacing: 1 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 11,
    marginTop: 10,
  },
  sectionTitle: { color: '#C9D2E2', fontSize: 14, fontWeight: '800', letterSpacing: 1.25 },
  languageLabel: { color: BLUE, fontSize: 14, fontWeight: '800', letterSpacing: 1.2 },
  prompt: {
    fontFamily: 'sans-serif',
    minHeight: 145,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: '#253147',
    borderRadius: 13,
    padding: 15,
    color: WHITE,
    fontSize: 14,
    lineHeight: 21,
  },
  characterCount: { color: '#647188', fontSize: 14, textAlign: 'right', marginTop: 7, marginBottom: 15 },
  optionRow: { flexDirection: 'row', gap: 11, marginBottom: 18 },
  option: {
    flex: 1,
    backgroundColor: PANEL,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#253147',
    padding: 14,
    alignItems: 'center',
  },
  selectedOption: { borderColor: BLUE, backgroundColor: '#142344' },
  optionMain: { color: WHITE, fontWeight: '800', fontSize: 16 },
  optionSub: { color: MUTED, fontSize: 14, marginTop: 4 },
  activeText: { color: WHITE },
  costCard: {
    backgroundColor: PANEL,
    borderRadius: 13,
    padding: 15,
    marginTop: 5,
    marginBottom: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#202B3E',
  },
  costLabel: { color: MUTED, fontSize: 14, letterSpacing: 1.5, fontWeight: '800' },
  costDescription: { color: WHITE, fontSize: 14, marginTop: 7 },
  costIcon: { color: BLUE, fontSize: 23 },
  createButton: {
    backgroundColor: '#2468F5',
    borderRadius: 15,
    paddingVertical: 19,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 5,
    minHeight: 62,
    borderWidth: 1,
    borderColor: '#78B5FF',
    shadowColor: '#167AFF',
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  disabledButton: { opacity: 0.55 },
  createButtonText: { color: WHITE, fontSize: 16, fontWeight: '900', fontFamily: 'sans-serif-medium', letterSpacing: 0.4 },
  generationModalBackdrop: { flex: 1, backgroundColor: 'rgba(2,7,19,0.88)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  generationModalCard: { width: '100%', maxWidth: 360, borderRadius: 24, padding: 26, alignItems: 'center', backgroundColor: '#0D1930', borderWidth: 1, borderColor: '#2B5A96', shadowColor: '#168EFF', shadowOpacity: 0.35, shadowRadius: 28, elevation: 18 },
  generationModalMark: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#102B5D', borderWidth: 1, borderColor: '#28B9FF', alignItems: 'center', justifyContent: 'center' },
  generationModalMarkText: { color: '#C8F5FF', fontSize: 15, fontWeight: '900' },
  generationModalTitle: { color: WHITE, fontSize: 20, lineHeight: 27, fontWeight: '900', textAlign: 'center', marginTop: 20 },
  generationModalDescription: { color: '#A8B7CD', fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 10 },
  generationModalHint: { color: '#7189B4', fontSize: 14, textAlign: 'center', marginTop: 15 },
  statusCard: {
    backgroundColor: '#101B30',
    borderWidth: 1,
    borderColor: '#263D65',
    borderRadius: 14,
    padding: 16,
    marginTop: 20,
  },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusTitle: { color: MUTED, fontSize: 14, fontWeight: '800', letterSpacing: 1.4 },
  statusValue: { color: WHITE, fontSize: 18, fontWeight: '800', marginTop: 12 },
  statusSuccess: { color: '#42D992' },
  statusDescription: { color: MUTED, fontSize: 14, lineHeight: 18, marginTop: 6 },progressSegment: { flex: 1, height: 6, borderRadius: 4, backgroundColor: '#263147' },
  progressSegmentActive: { backgroundColor: BLUE },galleryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  galleryLimit: { color: MUTED, fontSize: 14, marginTop: -12, marginBottom: 15 },
  galleryCard: { backgroundColor: PANEL, borderRadius: 14, padding: 12, marginTop: 14, borderWidth: 1, borderColor: '#253147' },
  videoFrame: { width: '100%', height: 220, backgroundColor: '#000000', borderRadius: 10, overflow: 'hidden', justifyContent: 'center' },
  videoPlayer: { width: '100%', height: 220, backgroundColor: '#000000' },
  videoControls: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(0,0,0,0.42)' },
  videoControlButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(17,24,39,0.88)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3978FF' },
  videoControlText: { color: WHITE, fontSize: 15, fontWeight: '900' },
  galleryVideoTitle: { color: WHITE, fontSize: 14, fontWeight: '800', marginTop: 12 },
  galleryDate: { color: MUTED, fontSize: 14, marginTop: 5 },
  galleryPrompt: { color: '#C9D2E2', fontSize: 14, lineHeight: 16, marginTop: 9 },
  galleryActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 8 },
  galleryActionButton: { borderWidth: 1, borderColor: 'rgba(57,120,255,0.45)', backgroundColor: 'rgba(57,120,255,0.10)', borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 },
  galleryActionText: { color: '#AFCBFF', fontSize: 14, fontWeight: '700' },
  deleteVideoButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 12, marginTop: 8, borderRadius: 8, backgroundColor: '#351D2A' },
  deleteVideoText: { color: '#FF9AA4', fontSize: 14, fontWeight: '700' },
  jobId: { color: '#687D9F', fontSize: 14, marginTop: 10 },
  errorText: { color: '#FF8A93', fontSize: 14, marginTop: 10 },
  secondaryButton: {
    minHeight: 52,
    backgroundColor: '#142344',
    borderColor: '#4A91FF',
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 48,
    borderRadius: 13,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#167AFF',
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 3,
  },
  secondaryButtonText: { color: WHITE, fontWeight: '700', fontSize: 14 },
  resetButton: { paddingVertical: 13, alignItems: 'center', marginTop: 8 },
  resetButtonText: { color: BLUE, fontWeight: '800', fontSize: 14 },
  footerNote: { color: MUTED, fontSize: 14, textAlign: 'center', marginTop: 19, marginBottom: 10 },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(10,16,29,0.97)',
    borderTopWidth: 1,
    borderTopColor: '#1B2434',
    paddingTop: 10,
    paddingBottom: 18,
    minHeight: 88,
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0, minHeight: 62, paddingHorizontal: 4, paddingTop: 4, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  navItemActive: { backgroundColor: '#142344', borderWidth: 1, borderColor: 'rgba(76,145,255,0.34)' },
  navIcon: { fontSize: 27, lineHeight: 33, color: BLUE },
  navCoin: { width: 27, height: 27, borderRadius: 14, borderWidth: 2, borderColor: BLUE, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', padding: 3 },
  navCoinInner: { width: '100%', height: '100%', borderRadius: 10, borderWidth: 1, borderColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  navCoinMark: { color: BLUE, fontSize: 14, lineHeight: 16, fontWeight: '900' },
  navPerson: { width: 29, height: 31, alignItems: 'center', justifyContent: 'flex-end' },
  navPersonHead: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: BLUE, backgroundColor: 'transparent', marginBottom: 3 },
  navPersonBody: { width: 23, height: 14, borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, borderWidth: 2, borderBottomWidth: 0, borderColor: BLUE, backgroundColor: 'transparent' },
  navLabel: { color: '#A5B2C8', fontSize: 14, lineHeight: 15, fontWeight: '700' },
  navLabelActive: { color: '#67A0FF', fontWeight: '900' },
  modeSelector: { flexDirection: 'row', backgroundColor: PANEL, borderRadius: 13, padding: 4, marginBottom: 18, borderWidth: 1, borderColor: '#253147' },
  modeOption: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, borderRadius: 10, alignItems: 'center' },
  modeOptionActive: { backgroundColor: '#1B3769', borderWidth: 1, borderColor: BLUE },
  modeOptionText: { color: MUTED, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  modeOptionTextActive: { color: WHITE },
  imageUploadCard: { backgroundColor: PANEL, borderRadius: 13, padding: 14, marginTop: 5, marginBottom: 15, borderWidth: 1, borderColor: '#253147' },
  chooseImageButton: { borderWidth: 1, borderStyle: 'dashed', borderColor: BLUE, borderRadius: 12, minHeight: 118, alignItems: 'center', justifyContent: 'center', marginTop: 12, backgroundColor: '#101B30' },
  chooseImageIcon: { color: '#67A0FF', fontSize: 30, fontWeight: '300' },
  chooseImageText: { color: WHITE, fontSize: 14, fontWeight: '800', marginTop: 5 },
  imageHint: { color: MUTED, fontSize: 14, marginTop: 5 },
  imagePreview: { width: '100%', height: 180, borderRadius: 10, marginTop: 12, backgroundColor: '#05080E' },
  imagePreviewPlaceholder: { height: 100, marginTop: 12, borderRadius: 10, backgroundColor: '#202A3A' },
  imageFileName: { color: MUTED, fontSize: 14, marginTop: 8 },
  removeImageButton: { alignSelf: 'flex-start', paddingVertical: 8, marginTop: 4 },
  removeImageText: { color: '#FF9AA4', fontSize: 14, fontWeight: '700' },
  languageCard: { backgroundColor: PANEL, borderRadius: 13, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#253147' },
  languageOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  languageOption: { flexGrow: 1, flexBasis: '28%', alignItems: 'center', paddingVertical: 10, borderRadius: 9, backgroundColor: '#0B1220', borderWidth: 1, borderColor: '#253147' },
  languageOptionActive: { borderColor: BLUE, backgroundColor: '#142344' },
  languageOptionText: { color: MUTED, fontSize: 14, fontWeight: '700' },
  languageOptionTextActive: { color: WHITE },
  screen: { flex: 1, paddingTop: 28 },
  screenTitle: { color: WHITE, fontSize: 32, fontWeight: '900', marginTop: 18, marginBottom: 26 },
  emptyScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 430, paddingHorizontal: 15 },
  emptyIcon: { color: BLUE, fontSize: 48, marginBottom: 15 },
  balanceCard: { backgroundColor: '#101B30', borderRadius: 16, borderWidth: 1, borderColor: '#263D65', padding: 22, marginTop: 12, marginBottom: 30 },
  balanceLabel: { color: MUTED, fontSize: 14, letterSpacing: 1.5, fontWeight: '800' },
  bigBalance: { color: WHITE, fontSize: 38, fontWeight: '900', marginTop: 10 },
  creditSymbol: { color: BLUE, fontSize: 27 },
  mutedText: { color: MUTED, fontSize: 14, lineHeight: 21, marginTop: 7 },
  packageCard: { backgroundColor: PANEL, borderRadius: 12, padding: 15, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#253147' },
  packageAmount: { color: WHITE, fontSize: 16, fontWeight: '800' },
  smallAction: { backgroundColor: '#172D51', paddingHorizontal: 14, paddingVertical: 9, minHeight: 38, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(76,145,255,0.30)', justifyContent: 'center' },
  purchaseDisabled: { opacity: 0.48, borderWidth: 1, borderColor: '#33445F' },
  smallActionText: { color: WHITE, fontSize: 14, fontWeight: '800' },
  note: { color: MUTED, fontSize: 14, lineHeight: 19, marginTop: 20 },
  profileCard: { backgroundColor: PANEL, borderRadius: 14, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#253147' },
  avatar: { width: 43, height: 43, borderRadius: 22, backgroundColor: '#1B3769', alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  avatarText: { color: WHITE, fontSize: 15, fontWeight: '900' },
  profileName: { color: WHITE, fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  menuItem: { minHeight: 56, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: '#202A3A', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  menuText: { color: '#DCE4F2', fontSize: 14, fontWeight: '600' },
  menuArrow: { color: MUTED, fontSize: 23 },
  authCard: { backgroundColor: PANEL, borderRadius: 14, padding: 16, marginBottom: 18, borderWidth: 1, borderColor: '#253147' },
  authInput: { fontFamily: 'sans-serif', backgroundColor: '#0B1220', borderWidth: 1, borderColor: '#253147', borderRadius: 10, paddingHorizontal: 13, paddingVertical: 13, color: WHITE, fontSize: 14, marginTop: 12 },
  authAction: { backgroundColor: '#2468F5', borderRadius: 13, paddingHorizontal: 15, paddingVertical: 15, minHeight: 50, borderWidth: 1, borderColor: '#78B5FF', alignItems: 'center', justifyContent: 'center', marginTop: 14, shadowColor: '#167AFF', shadowOpacity: 0.22, shadowRadius: 12, elevation: 4 },
  authSecondary: { backgroundColor: '#142344', borderColor: '#3978FF', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, minHeight: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  authSecondaryText: { color: WHITE, fontWeight: '700', fontSize: 14 },
  authTextButton: { paddingVertical: 12, alignItems: 'center' },
  authLinkText: { color: '#83B7FF', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  authDivider: { alignItems: 'center', marginTop: 4, marginBottom: 4 },
  authNotice: { color: '#83B7FF', fontSize: 14, lineHeight: 17, marginTop: 12 },
  screenTitle: { color: '#F5F8FF', fontSize: 21, lineHeight: 26, fontWeight: '800', marginTop: 3, marginBottom: 12, textShadowColor: 'rgba(35,145,255,0.40)', textShadowRadius: 10 },
  creditsTitle: { color: '#F5F8FF', fontSize: 21, lineHeight: 26, fontWeight: '800', textShadowColor: 'rgba(35,145,255,0.40)', textShadowRadius: 10 },
  creditPackagesTitle: { color: '#F5F8FF', fontSize: 15, fontWeight: '800', marginTop: 3, marginBottom: 5 },
  packageAmount: { color: '#F7FAFF', fontSize: 14, fontWeight: '800' },
  packagePrice: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  packagePriceHint: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  packageCard: { minHeight: 58, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(68,146,222,0.45)', backgroundColor: 'rgba(8,28,58,0.92)', shadowColor: '#168BFF', shadowOpacity: 0.18, shadowRadius: 12, elevation: 4 },
  packageCardPopular: { borderColor: '#20BFFF', backgroundColor: 'rgba(5,55,105,0.92)', shadowColor: '#00AFFF', shadowOpacity: 0.75, shadowRadius: 16, elevation: 8 },
  creditCoinReferenceCrop: { position: 'absolute', top: 3, left: 0, right: 0, width: 112, height: 67, alignSelf: 'center', overflow: 'hidden', borderRadius: 10 },
  creditIllustration: { height: 145, marginBottom: 14, borderRadius: 17, backgroundColor: 'rgba(4,19,47,0.93)', borderWidth: 1, borderColor: 'rgba(37,148,255,0.75)', shadowColor: '#087BFF', shadowOpacity: 0.25, shadowRadius: 20, elevation: 8 },
  creditBalanceHero: { position: 'absolute', bottom: 7, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  creditBalanceHeroValue: { color: '#FFD66F', fontSize: 31, lineHeight: 34, fontWeight: '900', textShadowColor: '#FF9E22', textShadowRadius: 15 },
  creditBalanceHeroLabel: { color: '#FFF0C2', fontSize: 12, fontWeight: '800', letterSpacing: 0.7, marginTop: 0 },
  buyCreditsButton: { minHeight: 52, marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: '#52D3FF', backgroundColor: '#0877F4', shadowColor: '#168BFF', shadowOpacity: 0.55, shadowRadius: 18, elevation: 8, alignItems: 'center', justifyContent: 'center' },
  featureSectionTitle: { color: '#F5F8FF', fontSize: 16, fontWeight: '800', marginBottom: 10 },
  featureTile: { width: '48.5%', minHeight: 112, padding: 10, borderRadius: 15, backgroundColor: 'rgba(5,22,51,0.86)', borderWidth: 1, borderColor: 'rgba(57,132,210,0.55)', shadowColor: '#087BFF', shadowOpacity: 0.14, shadowRadius: 10, elevation: 3 },
  featureTitle: { color: '#F4FAFF', fontSize: 12, fontWeight: '800', lineHeight: 15 },
  featureSubtitle: { color: '#8FB5DC', fontSize: 9, lineHeight: 12, marginTop: 2 },
  profileGuestAvatar: { width: 92, height: 92, borderRadius: 46, borderWidth: 2, borderColor: '#00BFFF', backgroundColor: 'rgba(0,91,180,0.18)', shadowColor: '#00AFFF', shadowOpacity: 0.92, shadowRadius: 24, elevation: 12, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  galleryTabText: { color: '#9DB8DA', fontSize: 12, fontWeight: '600' },
  galleryTabTextActive: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  galleryLimit: { color: '#B4CBE5', fontSize: 10, textAlign: 'center', marginTop: 10 },
  version: { color: '#566176', fontSize: 14, letterSpacing: 1.3, textAlign: 'center', marginTop: 35 },
  ...COSMIC_OVERRIDES,
  ...REFERENCE_POLISH,
  ...FINAL_UI_FIXES,
  ...FINAL_UI_FIXES_V2,
});

