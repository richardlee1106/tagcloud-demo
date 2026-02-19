import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
// 引入全局图标
import {
  ArrowLeft,
  Close,
  Hide,
  Loading,
  MagicStick,
  VideoPlay,
  View
} from '@element-plus/icons-vue'

const app = createApp(App)

// 注册所有图标
app.component('ArrowLeft', ArrowLeft)
app.component('Close', Close)
app.component('Hide', Hide)
app.component('Loading', Loading)
app.component('MagicStick', MagicStick)
app.component('VideoPlay', VideoPlay)
app.component('View', View)

app.use(ElementPlus)
app.use(router)

app.mount('#app')
