import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, './src'),
    },
  },
  // Leave native / Node-only server deps unbundled (resolved at runtime).
  // - better-sqlite3: native module.
  // - kysely / kysely-adapter: pulled in by better-auth; rolldown can't
  //   statically resolve their re-exports, so externalize for the server build.
  ssr: {
    external: ['better-sqlite3', 'kysely', '@better-auth/kysely-adapter'],
  },
  optimizeDeps: {
    exclude: ['better-sqlite3'],
  },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
})
