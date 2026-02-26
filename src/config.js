// API Base URL 配置
// 开发环境默认直连本机后端，避免代理/IPv6 解析差异导致的 502。
// 如需改端口，可设置 VITE_DEV_API_BASE，例如: http://127.0.0.1:3300
// 生产环境仍通过 Vercel Rewrite 代理。
const DEV_API_BASE_DEFAULT = 'http://127.0.0.1:3200'

export const API_BASE_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_DEV_API_BASE || DEV_API_BASE_DEFAULT)
  : '/proxy-api'

export default API_BASE_URL;
