import type { Estimate, EstimatePoint } from '@/types/planning/schema'

/** Plane `EstimateReadSerializer`: the estimate with its points. */
export function toEstimateRead<E extends Estimate>(estimate: E, points: EstimatePoint[]) {
  return { ...estimate, points: points.filter(point => point.estimateId === estimate.id) }
}

/** Plane `Estimate.__str__`. */
export function formatEstimate(estimate: Pick<Estimate, 'name'>, projectName: string) {
  return `${estimate.name} <${projectName}>`
}

/** Plane `EstimatePoint.__str__`. */
export function formatEstimatePoint(estimate: Pick<Estimate, 'name'>, point: Pick<EstimatePoint, 'key' | 'value'>) {
  return `${estimate.name} <${point.key}> <${point.value}>`
}
