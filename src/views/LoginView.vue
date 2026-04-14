<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../store/auth.js'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const submitLogin = async () => {
  const ok = await auth.login()
  if (ok) {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/swim'
    router.replace(redirect)
    return
  }
  if (auth.loginError.value) {
    ElMessage({
      type: 'error',
      message: auth.loginError.value,
      grouping: true,
      duration: 2200,
    })
  }
}

onMounted(() => {
  auth.fetchCaptcha()
})
</script>

<template>
  <div class="login-page">
    <div class="login-shell">
      <section class="login-card">
        <div class="login-card-header">
          <h2>登录系统</h2>
          <p>登录后进入训练工作台</p>
        </div>

        <label class="login-field">
          <span>用户名</span>
          <input v-model="auth.loginForm.value.username" type="text" autocomplete="username" placeholder="请输入用户名">
        </label>

        <label class="login-field">
          <span>密码</span>
          <input v-model="auth.loginForm.value.password" type="password" autocomplete="current-password" placeholder="请输入密码">
        </label>

        <label v-if="auth.captchaEnabled.value" class="login-field">
          <span>验证码</span>
          <div class="captcha-row">
            <input
              v-model="auth.loginForm.value.code"
              type="text"
              maxlength="4"
              autocomplete="off"
              placeholder="请输入验证码"
              @keyup.enter="submitLogin"
            >
            <img
              v-if="auth.captchaImage.value"
              class="captcha-image"
              :src="auth.captchaImage.value"
              alt="验证码"
              @click="auth.fetchCaptcha"
            >
            <button v-else class="captcha-fallback" type="button" @click="auth.fetchCaptcha">刷新</button>
          </div>
        </label>

        <p v-if="auth.loginError.value" class="login-error">{{ auth.loginError.value }}</p>

        <button class="login-btn" type="button" :disabled="auth.loginLoading.value" @click="submitLogin">
          {{ auth.loginLoading.value ? '登录中...' : '登录' }}
        </button>
      </section>
    </div>
  </div>
</template>
