export type Locale = 'vi' | 'en' | 'ja'
export type Messages = typeof import('@/data/i18n/vi.json')
export type MessageError = keyof Messages['errors']
