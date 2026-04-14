import { createRouter, createWebHistory } from 'vue-router'
import LoginView from '../views/LoginView.vue'
import SwimView from '../App.vue'
import FitnessTrainingView from '../views/FitnessTrainingView.vue'
import VideoAnalysisView from '../views/VideoAnalysisView.vue'
import VideoAnalysisDetailView from '../views/VideoAnalysisDetailView.vue'
import ShareView from '../views/ShareView.vue'
import { useAuthStore } from '../store/auth.js'

const routes = [
  { path: '/', redirect: '/swim' },
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/swim', name: 'swim', component: SwimView },
  { path: '/fitness', name: 'fitness', component: FitnessTrainingView },
  { path: '/analysis', name: 'analysis', component: VideoAnalysisView },
  { path: '/analysis/:taskId', name: 'analysis-detail', component: VideoAnalysisDetailView },
  { path: '/share/:shareCode', name: 'share', component: ShareView, meta: { public: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isLoggedIn.value) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.path === '/login' && auth.isLoggedIn.value) {
    return { path: '/swim' }
  }
  return true
})

export default router
