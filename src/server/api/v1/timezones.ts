import type { TimezoneEntry } from '@/types/api/schema'

// Friendly names and identifiers from Plane’s timezone endpoint.
const locations: ReadonlyArray<readonly [string, string]> = [
  [
    "Midway Island",
    "Pacific/Midway"
  ],
  [
    "American Samoa",
    "Pacific/Pago_Pago"
  ],
  [
    "Hawaii",
    "Pacific/Honolulu"
  ],
  [
    "Aleutian Islands",
    "America/Adak"
  ],
  [
    "Marquesas Islands",
    "Pacific/Marquesas"
  ],
  [
    "Alaska",
    "America/Anchorage"
  ],
  [
    "Gambier Islands",
    "Pacific/Gambier"
  ],
  [
    "Pacific Time (US and Canada)",
    "America/Los_Angeles"
  ],
  [
    "Baja California",
    "America/Tijuana"
  ],
  [
    "Mountain Time (US and Canada)",
    "America/Denver"
  ],
  [
    "Arizona",
    "America/Phoenix"
  ],
  [
    "Chihuahua, Mazatlan",
    "America/Chihuahua"
  ],
  [
    "Central Time (US and Canada)",
    "America/Chicago"
  ],
  [
    "Saskatchewan",
    "America/Regina"
  ],
  [
    "Guadalajara, Mexico City, Monterrey",
    "America/Mexico_City"
  ],
  [
    "Tegucigalpa, Honduras",
    "America/Tegucigalpa"
  ],
  [
    "Costa Rica",
    "America/Costa_Rica"
  ],
  [
    "Eastern Time (US and Canada)",
    "America/New_York"
  ],
  [
    "Lima",
    "America/Lima"
  ],
  [
    "Bogota",
    "America/Bogota"
  ],
  [
    "Quito",
    "America/Guayaquil"
  ],
  [
    "Chetumal",
    "America/Cancun"
  ],
  [
    "Caracas (Old Venezuela Time)",
    "America/Caracas"
  ],
  [
    "Atlantic Time (Canada)",
    "America/Halifax"
  ],
  [
    "Caracas",
    "America/Caracas"
  ],
  [
    "Santiago",
    "America/Santiago"
  ],
  [
    "La Paz",
    "America/La_Paz"
  ],
  [
    "Manaus",
    "America/Manaus"
  ],
  [
    "Georgetown",
    "America/Guyana"
  ],
  [
    "Bermuda",
    "Atlantic/Bermuda"
  ],
  [
    "Newfoundland Time (Canada)",
    "America/St_Johns"
  ],
  [
    "Buenos Aires",
    "America/Argentina/Buenos_Aires"
  ],
  [
    "Brasilia",
    "America/Sao_Paulo"
  ],
  [
    "Greenland",
    "America/Godthab"
  ],
  [
    "Montevideo",
    "America/Montevideo"
  ],
  [
    "Falkland Islands",
    "Atlantic/Stanley"
  ],
  [
    "South Georgia and the South Sandwich Islands",
    "Atlantic/South_Georgia"
  ],
  [
    "Azores",
    "Atlantic/Azores"
  ],
  [
    "Cape Verde Islands",
    "Atlantic/Cape_Verde"
  ],
  [
    "Dublin",
    "Europe/Dublin"
  ],
  [
    "Reykjavik",
    "Atlantic/Reykjavik"
  ],
  [
    "Lisbon",
    "Europe/Lisbon"
  ],
  [
    "Monrovia",
    "Africa/Monrovia"
  ],
  [
    "Casablanca",
    "Africa/Casablanca"
  ],
  [
    "Central European Time (Berlin, Rome, Paris)",
    "Europe/Paris"
  ],
  [
    "West Central Africa",
    "Africa/Lagos"
  ],
  [
    "Algiers",
    "Africa/Algiers"
  ],
  [
    "Lagos",
    "Africa/Lagos"
  ],
  [
    "Tunis",
    "Africa/Tunis"
  ],
  [
    "Eastern European Time (Cairo, Helsinki, Kyiv)",
    "Europe/Kyiv"
  ],
  [
    "Athens",
    "Europe/Athens"
  ],
  [
    "Jerusalem",
    "Asia/Jerusalem"
  ],
  [
    "Johannesburg",
    "Africa/Johannesburg"
  ],
  [
    "Harare, Pretoria",
    "Africa/Harare"
  ],
  [
    "Moscow Time",
    "Europe/Moscow"
  ],
  [
    "Baghdad",
    "Asia/Baghdad"
  ],
  [
    "Nairobi",
    "Africa/Nairobi"
  ],
  [
    "Kuwait, Riyadh",
    "Asia/Riyadh"
  ],
  [
    "Tehran",
    "Asia/Tehran"
  ],
  [
    "Abu Dhabi",
    "Asia/Dubai"
  ],
  [
    "Baku",
    "Asia/Baku"
  ],
  [
    "Yerevan",
    "Asia/Yerevan"
  ],
  [
    "Astrakhan",
    "Europe/Astrakhan"
  ],
  [
    "Tbilisi",
    "Asia/Tbilisi"
  ],
  [
    "Mauritius",
    "Indian/Mauritius"
  ],
  [
    "Kabul",
    "Asia/Kabul"
  ],
  [
    "Islamabad",
    "Asia/Karachi"
  ],
  [
    "Karachi",
    "Asia/Karachi"
  ],
  [
    "Tashkent",
    "Asia/Tashkent"
  ],
  [
    "Yekaterinburg",
    "Asia/Yekaterinburg"
  ],
  [
    "Maldives",
    "Indian/Maldives"
  ],
  [
    "Chagos",
    "Indian/Chagos"
  ],
  [
    "Chennai",
    "Asia/Kolkata"
  ],
  [
    "Kolkata",
    "Asia/Kolkata"
  ],
  [
    "Mumbai",
    "Asia/Kolkata"
  ],
  [
    "New Delhi",
    "Asia/Kolkata"
  ],
  [
    "Sri Jayawardenepura",
    "Asia/Colombo"
  ],
  [
    "Kathmandu",
    "Asia/Kathmandu"
  ],
  [
    "Dhaka",
    "Asia/Dhaka"
  ],
  [
    "Almaty",
    "Asia/Almaty"
  ],
  [
    "Bishkek",
    "Asia/Bishkek"
  ],
  [
    "Thimphu",
    "Asia/Thimphu"
  ],
  [
    "Yangon (Rangoon)",
    "Asia/Yangon"
  ],
  [
    "Cocos Islands",
    "Indian/Cocos"
  ],
  [
    "Bangkok",
    "Asia/Bangkok"
  ],
  [
    "Hanoi",
    "Asia/Ho_Chi_Minh"
  ],
  [
    "Jakarta",
    "Asia/Jakarta"
  ],
  [
    "Novosibirsk",
    "Asia/Novosibirsk"
  ],
  [
    "Krasnoyarsk",
    "Asia/Krasnoyarsk"
  ],
  [
    "Beijing",
    "Asia/Shanghai"
  ],
  [
    "Singapore",
    "Asia/Singapore"
  ],
  [
    "Perth",
    "Australia/Perth"
  ],
  [
    "Hong Kong",
    "Asia/Hong_Kong"
  ],
  [
    "Ulaanbaatar",
    "Asia/Ulaanbaatar"
  ],
  [
    "Palau",
    "Pacific/Palau"
  ],
  [
    "Eucla",
    "Australia/Eucla"
  ],
  [
    "Tokyo",
    "Asia/Tokyo"
  ],
  [
    "Seoul",
    "Asia/Seoul"
  ],
  [
    "Yakutsk",
    "Asia/Yakutsk"
  ],
  [
    "Adelaide",
    "Australia/Adelaide"
  ],
  [
    "Darwin",
    "Australia/Darwin"
  ],
  [
    "Sydney",
    "Australia/Sydney"
  ],
  [
    "Brisbane",
    "Australia/Brisbane"
  ],
  [
    "Guam",
    "Pacific/Guam"
  ],
  [
    "Vladivostok",
    "Asia/Vladivostok"
  ],
  [
    "Tahiti",
    "Pacific/Tahiti"
  ],
  [
    "Lord Howe Island",
    "Australia/Lord_Howe"
  ],
  [
    "Solomon Islands",
    "Pacific/Guadalcanal"
  ],
  [
    "Magadan",
    "Asia/Magadan"
  ],
  [
    "Norfolk Island",
    "Pacific/Norfolk"
  ],
  [
    "Bougainville Island",
    "Pacific/Bougainville"
  ],
  [
    "Chokurdakh",
    "Asia/Srednekolymsk"
  ],
  [
    "Auckland",
    "Pacific/Auckland"
  ],
  [
    "Wellington",
    "Pacific/Auckland"
  ],
  [
    "Fiji Islands",
    "Pacific/Fiji"
  ],
  [
    "Anadyr",
    "Asia/Anadyr"
  ],
  [
    "Chatham Islands",
    "Pacific/Chatham"
  ],
  [
    "Nuku'alofa",
    "Pacific/Tongatapu"
  ],
  [
    "Samoa",
    "Pacific/Apia"
  ],
  [
    "Kiritimati Island",
    "Pacific/Kiritimati"
  ]
]

/** Return the current offset, accounting for the timezone's daylight saving rules. */
export function getTimezones(now = new Date()): { timezones: TimezoneEntry[] } {
  const entries = locations.flatMap(([label, value]) => {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: value,
        timeZoneName: 'longOffset'
      }).formatToParts(now)
      const zone = parts.find(part => part.type === 'timeZoneName')?.value
      const match = zone?.match(/^GMT(?:([+-])(\d{2}):(\d{2}))?$/)
      if (!match) return []
      const sign = match[1] === '-' ? -1 : 1
      const minutes = sign * (Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0))
      // Match the upstream formatter, including its floor division for negative half-hour offsets.
      const hours = Math.floor(minutes / 60)
      const remainder = ((minutes % 60) + 60) % 60
      const formatted = `${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      return [{ sortOffset: minutes, utc_offset: `UTC${formatted}`, gmt_offset: `GMT${formatted}`, value, label }]
    } catch (error) {
      if (error instanceof RangeError) return []
      throw error
    }
  })
  entries.sort((a, b) => a.sortOffset - b.sortOffset || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
  return { timezones: entries.map(entry => ({ utc_offset: entry.utc_offset, gmt_offset: entry.gmt_offset, value: entry.value, label: entry.label })) }
}
