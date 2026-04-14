import { request, requestWithAuth } from './http.js'

export const getCaptchaImageApi = () =>
  request('/captchaImage', {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })

export const loginApi = (payload) =>
  request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
    body: JSON.stringify(payload),
  })

export const logoutApi = () =>
  requestWithAuth('/logout', {
    method: 'POST',
  })
