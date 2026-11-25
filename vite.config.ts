import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite'
import vinext from 'vinext'
import { cloudflare } from '@cloudflare/vite-plugin'
import { staticAssetsAdapter } from '@vinext/cloudflare/cache/static-assets-adapter'

const tunnelHost = 'vite.aiempie.cloud'

function protectLocalTools({ middlewares }: ViteDevServer | PreviewServer) {
  for (const path of ['/cdn-cgi/local', '/__debug']) {
    middlewares.use(path, (request, response, next) => {
      if (request.headers.host?.split(':')[0].toLowerCase() !== tunnelHost) return next()

      response.statusCode = 404
      response.end()
    })
  }
}

export default defineConfig({
  server: { allowedHosts: [tunnelHost] },
  plugins: [
    {
      name: 'protect-local-tools',
      enforce: 'pre',
      configureServer: protectLocalTools,
      configurePreviewServer: protectLocalTools
    },
    vinext({
      cache: { cdn: staticAssetsAdapter() }
    }),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr']
      }
    })
  ]
})
