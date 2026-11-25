export type Locale = 'vi' | 'en'
export type Messages = typeof import('@/data/i18n/vi.json')
export type MessageError = keyof Messages['errors']
