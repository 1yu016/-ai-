import { createApp } from 'vue'
import 'element-plus/dist/index.css'
import './styles/theme.css'

import App from './App.vue'
import router from './router'
import { pinia } from './stores'
import { useConversationStore } from './stores/conversation'
import { useClassroomCommandStore } from './stores/classroomCommand'
import { useClassroomAssistantStore } from './stores/classroomAssistant'
import { useCourseResourceStore } from './stores/courseResource'
import { useFavoriteStore } from './stores/favorite'
import { useResourcePlayerStore } from './stores/resourcePlayer'
import { useUserStore } from './stores/user'

const app = createApp(App)

app.use(pinia)
useUserStore(pinia).initialize()
useConversationStore(pinia).initialize()
useCourseResourceStore(pinia).initialize()
useFavoriteStore(pinia).initialize()
useResourcePlayerStore(pinia).initialize()
useClassroomCommandStore(pinia).initialize()
useClassroomAssistantStore(pinia).initialize()
app.use(router)

app.mount('#app')
