/** Type-safe admin commands (Plane `types/admin-commands.ts`). The Redis admin channel is replaced by the Durable Object. */

export enum ForceCloseReason {
  CRITICAL_ERROR = 'critical_error',
  MEMORY_LEAK = 'memory_leak',
  DOCUMENT_TOO_LARGE = 'document_too_large',
  ADMIN_REQUEST = 'admin_request',
  SERVER_SHUTDOWN = 'server_shutdown',
  SECURITY_VIOLATION = 'security_violation',
  CORRUPTION_DETECTED = 'corruption_detected'
}

/** WebSocket close codes. 4000 and above are application codes. */
export enum CloseCode {
  NORMAL = 1000,
  GOING_AWAY = 1001,
  PROTOCOL_ERROR = 1002,
  UNSUPPORTED_DATA = 1003,
  INVALID_DATA = 1007,
  POLICY_VIOLATION = 1008,
  MESSAGE_TOO_BIG = 1009,
  INTERNAL_ERROR = 1011,
  FORCE_CLOSE = 4000,
  DOCUMENT_TOO_LARGE = 4001,
  MEMORY_PRESSURE = 4002,
  SECURITY_VIOLATION = 4003
}

export enum AdminCommand {
  FORCE_CLOSE = 'force_close',
  HEALTH_CHECK = 'health_check',
  RESTART_DOCUMENT = 'restart_document'
}

export interface ForceCloseCommandData {
  command: AdminCommand.FORCE_CLOSE
  docId: string
  reason: ForceCloseReason
  code: CloseCode
  originServer: string
  timestamp?: string
}

export interface HealthCheckCommandData {
  command: AdminCommand.HEALTH_CHECK
  originServer: string
  timestamp: string
}

export type AdminCommandData = ForceCloseCommandData | HealthCheckCommandData

/** Message sent to every client (as a stateless message) before the socket is closed. */
export interface ClientForceCloseMessage {
  type: 'force_close'
  reason: ForceCloseReason
  code: CloseCode
  message?: string
  timestamp?: string
}

export function isForceCloseCommand(data: AdminCommandData): data is ForceCloseCommandData {
  return data.command === AdminCommand.FORCE_CLOSE
}

export function isHealthCheckCommand(data: AdminCommandData): data is HealthCheckCommandData {
  return data.command === AdminCommand.HEALTH_CHECK
}

export function isValidForceCloseReason(reason: string): reason is ForceCloseReason {
  return Object.values(ForceCloseReason).includes(reason as ForceCloseReason)
}

export function getForceCloseMessage(reason: ForceCloseReason): string {
  const messages: Record<ForceCloseReason, string> = {
    [ForceCloseReason.CRITICAL_ERROR]: 'A critical error occurred. Please refresh the page.',
    [ForceCloseReason.MEMORY_LEAK]: 'Memory limit exceeded. Please refresh the page.',
    [ForceCloseReason.DOCUMENT_TOO_LARGE]:
      'Content limit reached and live sync is off. Create a new page or use nested pages to continue syncing.',
    [ForceCloseReason.ADMIN_REQUEST]: 'Connection closed by administrator. Please try again later.',
    [ForceCloseReason.SERVER_SHUTDOWN]: 'Server is shutting down. Please reconnect in a moment.',
    [ForceCloseReason.SECURITY_VIOLATION]: 'Security violation detected. Connection terminated.',
    [ForceCloseReason.CORRUPTION_DETECTED]: 'Data corruption detected. Please refresh the page.'
  }
  return messages[reason] || 'Connection closed. Please refresh the page.'
}
