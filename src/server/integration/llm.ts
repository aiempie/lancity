import { getConfigurationValue } from '@/server/instance/instance-value'
import type { InfraEnv } from '@/server/common/env'
import { logException } from '@/server/common/exception-logger'
import type { LancityDb } from '@/types/database/schema'

/**
 * Plane `get_configuration_value`: a stored instance configuration (decrypted when encrypted) wins over the
 * environment variable. A blank or undecryptable row falls back to the environment value.
 */
export async function getConfigurationValues<K extends string>(
  db: LancityDb,
  env: InfraEnv,
  keys: readonly K[]
): Promise<Record<K, string | undefined>> {
  const values = await getConfigurationValue(
    db,
    keys.map(key => ({ key, default: undefined })),
    env as Record<string, unknown>
  )
  const result = {} as Record<K, string | undefined>
  keys.forEach((key, index) => {
    const fromEnv = env[key]
    result[key] = values[index]?.trim() || (typeof fromEnv === 'string' && fromEnv.trim() ? fromEnv.trim() : undefined)
  })
  return result
}

export type LlmProvider = { name: string; models: readonly string[]; defaultModel: string }

/** Plane `LLMProvider.get_config`. */
export const getConfigLlmProvider = (provider: LlmProvider) => ({
  name: provider.name,
  models: [...provider.models],
  default_model: provider.defaultModel
})

/** Plane `SUPPORTED_PROVIDERS` (model lists copied from the source). */
export const SUPPORTED_PROVIDERS: Record<string, LlmProvider> = {
  openai: {
    name: 'OpenAI',
    models: ['gpt-3.5-turbo', 'gpt-4o-mini', 'gpt-4o', 'o1-mini', 'o1-preview'],
    defaultModel: 'gpt-4o-mini'
  },
  anthropic: {
    name: 'Anthropic',
    models: [
      'claude-3-5-sonnet-20240620',
      'claude-3-haiku-20240307',
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-2.1',
      'claude-2',
      'claude-instant-1.2',
      'claude-instant-1'
    ],
    defaultModel: 'claude-3-sonnet-20240229'
  },
  gemini: {
    name: 'Gemini',
    models: ['gemini-pro', 'gemini-1.5-pro-latest', 'gemini-pro-vision'],
    defaultModel: 'gemini-pro'
  }
}

export type LlmConfig = { apiKey: string; model: string; provider: string }

/**
 * Plane `get_llm_config`: `LLM_API_KEY`, `LLM_PROVIDER` (default `openai`) and `LLM_MODEL` (default: the
 * provider's). Returns null, after logging why, when the provider, key or model is unusable.
 */
export async function getLlmConfig(db: LancityDb, env: InfraEnv): Promise<LlmConfig | null> {
  const values = await getConfigurationValues(db, env, ['LLM_API_KEY', 'LLM_PROVIDER', 'LLM_MODEL'] as const)
  const providerKey = values.LLM_PROVIDER ?? 'openai'
  const provider = SUPPORTED_PROVIDERS[providerKey.toLowerCase()]
  if (!provider) {
    logException(new Error(`Unsupported provider: ${providerKey}`), { warning: true })
    return null
  }
  if (!values.LLM_API_KEY) {
    logException(new Error(`Missing API key for provider: ${provider.name}`), { warning: true })
    return null
  }
  const model = values.LLM_MODEL ?? provider.defaultModel
  if (!provider.models.includes(model)) {
    logException(
      new Error(`Model ${model} not supported by ${provider.name}. Supported models: ${provider.models.join(', ')}`),
      { warning: true }
    )
    return null
  }
  return { apiKey: values.LLM_API_KEY, model, provider: providerKey }
}

type Completion = {
  url: string
  headers: Record<string, string>
  body: unknown
  read: (json: unknown) => string | undefined
}

const asRecord = (value: unknown) => (value && typeof value === 'object' ? (value as Record<string, any>) : {}) // eslint-disable-line @typescript-eslint/no-explicit-any

/** One chat completion request per provider, over `fetch` (the Python SDK is not available on Workers). */
function buildCompletion(text: string, { apiKey, model, provider }: LlmConfig): Completion {
  switch (provider.toLowerCase()) {
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: { model, max_tokens: 1024, messages: [{ role: 'user', content: text }] },
        read: json => (asRecord(json).content as { text?: string }[] | undefined)?.map(part => part.text ?? '').join('')
      }
    case 'gemini':
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: { 'x-goog-api-key': apiKey },
        body: { contents: [{ parts: [{ text }] }] },
        read: json =>
          (asRecord(json).candidates?.[0]?.content?.parts as { text?: string }[] | undefined)
            ?.map(part => part.text ?? '')
            .join('')
      }
    default:
      return {
        url: 'https://api.openai.com/v1/chat/completions',
        headers: { authorization: `Bearer ${apiKey}` },
        body: { model, messages: [{ role: 'user', content: text }] },
        read: json => asRecord(json).choices?.[0]?.message?.content ?? undefined
      }
  }
}

/** Plane `get_llm_response`: `{ text, error }`. The provider's error text is mapped to a short message. */
export async function getLlmResponse(
  task: string,
  prompt: string,
  config: LlmConfig,
  fetcher: typeof fetch = fetch
): Promise<{ text: string | null; error: string | null }> {
  const request = buildCompletion(`${task}\n${prompt}`, config)
  try {
    const response = await fetcher(request.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...request.headers },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(60_000)
    })
    if (response.status === 401 || response.status === 403)
      return { text: null, error: `Invalid API key for ${config.provider}` }
    if (response.status === 429) return { text: null, error: `Rate limit exceeded for ${config.provider}` }
    if (!response.ok) throw new Error(`${config.provider} responded with ${response.status}`)
    const text = request.read(await response.json())
    if (!text) throw new Error(`${config.provider} returned an empty completion`)
    return { text, error: null }
  } catch (error) {
    logException(error, { context: { label: 'llm' } })
    return { text: null, error: `Error occurred while generating response from ${config.provider}` }
  }
}
