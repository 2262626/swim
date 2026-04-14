import { ref, computed } from 'vue'
import { getCaptchaImageApi, loginApi, logoutApi } from '../api/auth.js'
import { useTokenRef, setAccessToken, clearAccessToken } from './authToken.js'

const token = useTokenRef()
const captchaImage = ref('')
const captchaEnabled = ref(true)
const loginLoading = ref(false)
const loginError = ref('')
const loginForm = ref({
  username: 'admin',
  password: 'admin123',
  code: '',
  uuid: '',
})

const isLoggedIn = computed(() => !!token.value)

const fetchCaptcha = async () => {
  try {
    const data = await getCaptchaImageApi()
    if (!data?.img) {
      throw new Error(data?.msg || '验证码获取失败')
    }
    captchaImage.value = `data:image/gif;base64,${data.img}`
    loginForm.value.uuid = data.uuid || ''
    captchaEnabled.value = data.captchaEnabled !== false
    if (!captchaEnabled.value) {
      loginForm.value.code = ''
    }
  } catch (err) {
    captchaImage.value = ''
    loginForm.value.uuid = ''
    loginError.value = err?.message || '验证码获取失败'
  }
}

const login = async () => {
  if (loginLoading.value) return false
  loginError.value = ''

  const payload = {
    username: loginForm.value.username.trim(),
    password: loginForm.value.password,
    code: loginForm.value.code.trim(),
    uuid: loginForm.value.uuid,
  }

  if (!payload.username || !payload.password) {
    loginError.value = '请输入用户名和密码'
    return false
  }

  if (captchaEnabled.value && !payload.code) {
    loginError.value = '请输入验证码'
    return false
  }

  loginLoading.value = true
  try {
    const data = await loginApi(payload)
    if (data?.token) {
      setAccessToken(data.token)
      loginForm.value.password = ''
      loginForm.value.code = ''
      return true
    }
    loginError.value = data?.msg || '登录失败，请检查账号信息'
    loginForm.value.code = ''
    await fetchCaptcha()
    return false
  } catch (err) {
    loginError.value = err?.message || '登录请求失败'
    loginForm.value.code = ''
    if (captchaEnabled.value) {
      await fetchCaptcha()
    }
    return false
  } finally {
    loginLoading.value = false
  }
}

const logout = () => {
  clearAccessToken()
}

const logoutWithApi = async () => {
  try {
    if (token.value) {
      await logoutApi()
    }
  } catch (_) {
    // 忽略退出接口异常，保证本地状态可被清理
  } finally {
    logout()
  }
}

export const useAuthStore = () => ({
  token,
  isLoggedIn,
  loginForm,
  captchaImage,
  captchaEnabled,
  loginLoading,
  loginError,
  fetchCaptcha,
  login,
  logoutWithApi,
  logout,
})
