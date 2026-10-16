import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: the API runs on :3001 and is proxied, so the session cookie stays same-origin.
// `--mode pages`: browser-only build for GitHub Pages (data on the device, relative paths for /<repo>/).
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? './' : '/',
  plugins: [react()],
  server: {
    host: true,
    proxy: { '/api': 'http://localhost:3001', '/scriptable': 'http://localhost:3001' },
    // the on-device backend imports validation / pay calculation from ../server/src
    fs: { allow: ['..'] },
  },
}))
