import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts on purpose: the vinext and Cloudflare plugins would start the Worker runtime.
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) }

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: {
          alias: {
            ...alias,
            'cloudflare:workers': fileURLToPath(new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url))
          }
        },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/*.test.{ts,mjs}']
        }
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/*.integration.mjs'],
          // The files share one dev server and one D1 database, like `node --test --test-concurrency=1` did.
          fileParallelism: false,
          // Background jobs run through a Queue with a 5 s batch timeout and the tests poll for up to 15 s.
          testTimeout: 30_000,
          hookTimeout: 30_000
        }
      },
      {
        // Editor code in a simulated DOM: extensions, helpers and component smoke tests.
        plugins: [react()],
        resolve: {
          alias: {
            ...alias,
            // CommonJS on Node would `require` the CJS build of prosemirror-state next to the ESM one (two plugin
            // key registries, "Adding different instances of a keyed plugin"). Browsers bundle its ESM build.
            'prosemirror-codemark': fileURLToPath(
              new URL('./node_modules/prosemirror-codemark/dist/esm/index.js', import.meta.url)
            )
          }
        },
        test: {
          name: 'editor',
          environment: 'happy-dom',
          // Its ESM build ships as `.js` in a CommonJS package, so Vite has to transform it.
          server: { deps: { inline: ['prosemirror-codemark'] } },
          include: ['src/components/editor/**/*.test.{ts,tsx}', 'tests/editor/**/*.test.{ts,tsx}'],
          exclude: ['**/*.browser.test.{ts,tsx}', '**/node_modules/**']
        }
      },
      {
        // Interactions that need a real browser (focus, selection, menus): Chromium through Playwright.
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.{ts,tsx}', 'tests/editor/**/*.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }]
          }
        }
      }
    ]
  }
})
