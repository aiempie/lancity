import { existsSync, readFileSync } from 'node:fs'
import { bindings, defineConfig, defineWorker, exports, triggers } from 'cf/config'

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID
const assetBucketName = process.env.CLOUDFLARE_R2_BUCKET

// Optional secrets and settings. A secret binding is always reported as required when it is missing, and
// bindings.secret() has no optional form. So they are declared for local development only when .dev.vars sets
// a non-empty value, which lets the Vite plugin inject them without 'Missing required secrets' warnings.
// On Cloudflare they are set as Secrets or Variables in the dashboard.
const devVarsPath = new URL('./.dev.vars', import.meta.url)
const devVarNames = new Set(
  existsSync(devVarsPath)
    ? readFileSync(devVarsPath, 'utf8')
        .split('\n')
        .map(line => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\S/.exec(line)?.[1])
        .filter((name): name is string => Boolean(name))
    : []
)
const optionalSecrets = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITLAB_CLIENT_ID',
  'GITLAB_CLIENT_SECRET',
  'GITEA_CLIENT_ID',
  'GITEA_CLIENT_SECRET',
  'LLM_API_KEY',
  'UNSPLASH_ACCESS_KEY'
] as const

// Optional tunables read through getEnv(). Declared for local development only, like the secrets above.
const optionalSettings = [
  'APP_BASE_URL',
  'WEB_URL',
  'ADMIN_BASE_URL',
  'ADMIN_BASE_PATH',
  'SPACE_BASE_URL',
  'SPACE_BASE_PATH',
  'CORS_ALLOWED_ORIGINS',
  'AUTHENTICATION_RATE_LIMIT',
  'API_KEY_RATE_LIMIT',
  'PUBLIC_ANON_RATE_LIMIT',
  'PUBLIC_WRITE_RATE_LIMIT',
  'GITHUB_ORGANIZATION_ID',
  'GITLAB_HOST',
  'GITEA_HOST',
  'FILE_SIZE_LIMIT',
  'UNUPLOADED_ASSET_DELETE_DAYS',
  'LIVE_URL',
  'LIVE_CORS_ALLOWED_ORIGINS',
  'APP_VERSION',
  'LATEST_VERSION_URL',
  'LLM_PROVIDER',
  'LLM_MODEL',
  'WEBHOOK_ALLOWED_IPS',
  'WEBHOOK_ALLOWED_HOSTS',
  'WEBHOOK_DISALLOWED_DOMAINS',
  'EMAIL_LOG_RETENTION_DAYS',
  'API_ACTIVITY_LOG_RETENTION_DAYS',
  'WEBHOOK_LOG_RETENTION_DAYS',
  'JOB_CLAIM_RETENTION_DAYS',
  'HARD_DELETE_AFTER_DAYS',
  'TELEMETRY_ENABLED',
  'OTLP_ENDPOINT',
  'METRICS_PUSH_INTERVAL_MINUTES',
  'SERVICE_NAME',
  'INSTANCE_CHANGELOG_URL',
  'GITHUB_APP_NAME',
  'SLACK_CLIENT_ID'
] as const

export default defineConfig({
  worker: defineWorker({
    name: 'lancity',
    // Wraps the Vinext fetch handler and adds queue and scheduled handlers.
    entrypoint: './src/worker.ts',
    compatibilityDate: '2026-11-20',
    compatibilityFlags: ['nodejs_compat'],
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*']
    },
    triggers: [
      triggers.queue({
        name: 'lancity-jobs',
        deadLetterQueue: 'lancity-jobs-dlq',
        maxBatchSize: 10,
        maxBatchTimeout: 5,
        maxRetries: 5
      }),
      // One 5-minute tick; registerScheduled() cron expressions are matched against it in code.
      triggers.scheduled({ schedule: '*/5 * * * *' })
    ],
    // Durable Object class exported by src/worker.ts. `sqlite` storage creates it with `new_sqlite_classes`.
    exports: {
      CollaborationDO: exports.durableObject({ storage: 'sqlite' })
    },
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({
        name: 'lancity-db',
        id: databaseId || '5d409276-d8b5-4cb6-8917-f572c940d2cc'
      }),
      JOBS_QUEUE: bindings.queue({ name: 'lancity-jobs' }),
      // Live editor: one Durable Object per page (Yjs document and WebSocket hibernation).
      COLLABORATION: bindings.durableObject({ worker: 'lancity', exportName: 'CollaborationDO' }),
      // Browser Rendering for PDF export of pages. Needs a Workers plan that includes Browser Rendering.
      BROWSER: bindings.browser(),
      ...((assetBucketName || !databaseId) && {
        ASSET_BUCKET: bindings.r2({ name: assetBucketName || 'lancity-assets' })
      }),
      // The Vite plugin injects .dev.vars only for declared bindings. Production
      // uses Worker Secrets, including when no Google credentials are configured.
      ...(!databaseId && {
        BETTER_AUTH_SECRET: bindings.secret(),
        BETTER_AUTH_URL: bindings.secret(),
        LIVE_SERVER_SECRET_KEY: bindings.secret(),
        INSTANCE_ENCRYPTION_KEY: bindings.secret(),
        GMAIL_USER: bindings.secret(),
        GMAIL_APP_PASSWORD: bindings.secret(),
        MAIL_FROM: bindings.secret(),
        ...Object.fromEntries(
          [...optionalSecrets, ...optionalSettings, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
            .filter(name => devVarNames.has(name))
            .map(name => [name, bindings.secret()])
        )
      })
    }
  })
})
