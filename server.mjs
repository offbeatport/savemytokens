/**
 * Production server for Coolify / any Node host.
 *
 *   pnpm build && pnpm start   (PORT defaults to 3000)
 *
 * This TanStack Start build emits a web fetch-handler (dist/server/server.js)
 * plus static client assets (dist/client). We serve the assets ourselves and
 * hand everything else to the SSR handler. Dependency-free — Node 18.17+/20+/24
 * provides global Request/Response and stream web interop.
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { Readable } from 'node:stream'
import handler from './dist/server/server.js'

const PORT = Number(process.env.PORT) || 3000
const HOST = process.env.HOST || '0.0.0.0'
const CLIENT_DIR = join(import.meta.dirname, 'dist', 'client')

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
}

async function tryStatic(pathname) {
  if (pathname === '/' || pathname.endsWith('/')) return null
  const filePath = join(CLIENT_DIR, decodeURIComponent(pathname))
  // path-traversal guard
  if (!filePath.startsWith(CLIENT_DIR)) return null
  try {
    const s = await stat(filePath)
    if (!s.isFile()) return null
    return { body: await readFile(filePath), type: MIME[extname(filePath)] ?? 'application/octet-stream' }
  } catch {
    return null
  }
}

function toWebRequest(req) {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url}`
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
  }
  const method = req.method ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return new Request(url, {
    method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: 'half',
  })
}

createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname

    // Static assets first (hashed /assets/* are immutable; others no-cache).
    if (pathname.startsWith('/assets/') || /\.[a-z0-9]+$/i.test(pathname)) {
      const file = await tryStatic(pathname)
      if (file) {
        res.writeHead(200, {
          'content-type': file.type,
          'cache-control': pathname.startsWith('/assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        })
        res.end(file.body)
        return
      }
    }

    // SSR + server routes.
    const webRes = await handler.fetch(toWebRequest(req))
    res.statusCode = webRes.status
    webRes.headers.forEach((value, key) => res.setHeader(key, value))
    if (webRes.body) {
      Readable.fromWeb(webRes.body).pipe(res)
    } else {
      res.end()
    }
  } catch (err) {
    console.error('[server] request failed:', err)
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('Internal Server Error')
  }
}).listen(PORT, HOST, () => {
  console.log(`SaveMyTokens running on http://${HOST}:${PORT}`)
})
