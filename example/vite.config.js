import { defineConfig } from 'vite'
import sri from 'vite-plugin-sri4'

export default defineConfig({
  plugins: [
    sri({
      debug: true
    })
  ]
})
