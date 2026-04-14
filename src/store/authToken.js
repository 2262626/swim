import { ref } from 'vue'

export const AUTH_TOKEN_KEY = 'ruoyi_token'

const tokenRef = ref(localStorage.getItem(AUTH_TOKEN_KEY) || '')

export const useTokenRef = () => tokenRef

export const getAccessToken = () => tokenRef.value

export const setAccessToken = (token) => {
  tokenRef.value = token || ''
  if (tokenRef.value) {
    localStorage.setItem(AUTH_TOKEN_KEY, tokenRef.value)
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY)
  }
}

export const clearAccessToken = () => {
  setAccessToken('')
}
