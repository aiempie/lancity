/** Plane `get_default_preference` (PD-1455): legacy JSON default of the preference model, kept for reference. */
export function getDefaultPreference() {
  return {
    property_change: { email: true },
    state: { email: true },
    comment: { email: true },
    mentions: { email: true }
  }
}

/** Column defaults of `user_notification_preferences`: every kind of email is on until the user changes it. */
export const DEFAULT_NOTIFICATION_PREFERENCE = {
  propertyChange: true,
  stateChange: true,
  comment: true,
  mention: true,
  issueCompleted: true
} as const
