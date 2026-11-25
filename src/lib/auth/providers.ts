import { getDisplayName } from '@/server/identity/model-rules'
import type { OauthProviderSettings } from '@/server/identity/settings'

const UA = { 'User-Agent': 'Lancity' }

async function getJson(url: string, accessToken: string | undefined): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, { headers: { ...UA, Accept: 'application/json', Authorization: `Bearer ${accessToken ?? ''}` } })
  return { ok: response.ok, status: response.status, body: response.ok ? await response.json().catch(() => null) : null }
}

type Emails = { email?: string; primary?: boolean; verified?: boolean }[]
const pickEmail = (emails: unknown, fallbackAnyVerified: boolean): string | undefined => {
  if (!Array.isArray(emails)) return undefined
  const list = emails as Emails
  return (
    list.find(item => item.primary && item.verified)?.email ??
    (fallbackAnyVerified ? list.find(item => item.verified)?.email : undefined)
  )
}

type Profile = Record<string, unknown>
const str = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/** PD-1004..1008 GitHub: primary verified email only (GITHUB_OAUTH_PROVIDER_ERROR / OAUTH_PROVIDER_UNVERIFIED_EMAIL), optional organization gate. */
export function githubOptions(settings: OauthProviderSettings) {
  const org = settings.organizationId
  return {
    clientId: settings.clientId!,
    clientSecret: settings.clientSecret!,
    overrideUserInfoOnSignIn: settings.sync, // PD-0972 ENABLE_GITHUB_SYNC
    scope: org ? ['read:user', 'user:email', 'read:org'] : ['read:user', 'user:email'],
    async getUserInfo(token: { accessToken?: string }) {
      const me = await getJson('https://api.github.com/user', token.accessToken)
      const profile = me.body as Profile | null
      if (!profile) return null
      if (org) {
        const membership = await getJson(`https://api.github.com/orgs/${encodeURIComponent(org)}/memberships/${encodeURIComponent(String(profile.login))}`, token.accessToken)
        if (membership.status !== 200) return null // GITHUB_USER_NOT_IN_ORG
      }
      const email = pickEmail((await getJson('https://api.github.com/user/emails', token.accessToken)).body, false)
      if (!email) return null
      return {
        user: { name: str(profile.name) ?? str(profile.login) ?? getDisplayName(email), email, image: str(profile.avatar_url), emailVerified: true },
        data: profile as never
      }
    }
  }
}

/** PD-1009..1011 GitLab: reject accounts without `confirmed_at` (GHSA-7j95-vh8g-f365). */
export function gitlabOptions(settings: OauthProviderSettings) {
  const host = settings.host ?? 'https://gitlab.com'
  return {
    clientId: settings.clientId!,
    clientSecret: settings.clientSecret!,
    issuer: host,
    overrideUserInfoOnSignIn: settings.sync, // PD-0972 ENABLE_GITLAB_SYNC
    scope: ['read_user'],
    async getUserInfo(token: { accessToken?: string }) {
      const me = await getJson(`${host}/api/v4/user`, token.accessToken)
      const profile = me.body as Profile | null
      const email = str(profile?.email)
      if (!profile || !email || !profile.confirmed_at) return null
      return {
        user: { name: str(profile.name) ?? str(profile.username) ?? getDisplayName(email), email, image: str(profile.avatar_url), emailVerified: true },
        data: profile as never
      }
    }
  }
}

/** PD-1000..1003 Gitea: any primary-or-verified email from `/api/v1/user/emails`; host must be a valid http(s) URL. */
export function giteaConfig(settings: OauthProviderSettings) {
  const host = settings.host!
  const parsed = new URL(host)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('GITEA_HOST must be an http(s) URL')
  return {
    providerId: 'gitea',
    clientId: settings.clientId!,
    clientSecret: settings.clientSecret!,
    authorizationUrl: `${host}/login/oauth/authorize`,
    tokenUrl: `${host}/login/oauth/access_token`,
    userInfoUrl: `${host}/api/v1/user`,
    scopes: ['openid', 'email', 'profile', 'read:user'],
    async getUserInfo(tokens: { accessToken?: string }) {
      const me = await getJson(`${host}/api/v1/user`, tokens.accessToken)
      const profile = me.body as Profile | null
      if (!profile) return null
      const email = pickEmail((await getJson(`${host}/api/v1/user/emails`, tokens.accessToken)).body, true)
      if (!email) return null
      return {
        id: String(profile.id),
        name: str(profile.full_name) ?? str(profile.login) ?? getDisplayName(email),
        email,
        image: str(profile.avatar_url),
        emailVerified: true
      }
    }
  }
}
