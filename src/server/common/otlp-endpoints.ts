import { urlparse } from '@/server/common/url'

const OTLP_GRPC_DEFAULT_PORT = '4317'
const HTTPS_DEFAULT_PORT = '443'
const DEFAULT_OTLP_ENDPOINT = 'https://telemetry.plane.so'

export type OtlpEnv = { OTLP_ENDPOINT?: string }

/**
 * Plane `grpc_endpoint_from_url`: derive `host:port` from an OTLP URL.
 * An explicit port is kept, https defaults to 443, anything else to the gRPC port 4317.
 */
export function grpcEndpointFromUrl(url: string): string {
  const parsed = urlparse(url.includes('://') ? url : `//${url}`)
  const host = parsed.hostname || 'telemetry.plane.so'
  const port = parsed.port !== null ? String(parsed.port) : parsed.scheme === 'https' ? HTTPS_DEFAULT_PORT : OTLP_GRPC_DEFAULT_PORT
  return `${host}:${port}`
}

/** Plane `get_otlp_grpc_endpoint`. */
export function getOtlpGrpcEndpoint(env: OtlpEnv = {}): string {
  return grpcEndpointFromUrl(env.OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT)
}

/** Plane `get_otlp_http_metrics_url`: `OTLP_ENDPOINT` + `/v1/metrics`. */
export function getOtlpHttpMetricsUrl(env: OtlpEnv = {}): string {
  return `${(env.OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT).replace(/\/+$/, '')}/v1/metrics`
}
