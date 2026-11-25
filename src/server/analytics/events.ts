/** Job types of the analytics domain (`<domain>.<action>`). Payloads are small JSON, see `p3-analytics-schema.ts`. */
export const ANALYTICS_JOB = {
  /** Plane `analytic_export_task`: payload `{ exportId }`. */
  exportPlot: 'analytics.export_plot',
  /** Plane `export_analytics_to_csv_email`: payload `AnalyticCsvEmailJob`. */
  exportCsvEmail: 'analytics.export_csv_email'
} as const
