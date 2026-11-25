/**
 * OpenAPI 3 description helpers (Plane `utils/openapi/*`, built on drf-spectacular). Operations are plain
 * objects, so the documents can be assembled from Zod schemas or written by hand and served as JSON.
 */

export type OpenApiParameter = {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  description?: string
  schema: { type: 'string' | 'integer' | 'boolean'; format?: string; example?: unknown }
}

export type OpenApiResponse = {
  description: string
  content?: Record<string, { schema?: unknown; examples?: Record<string, { value: unknown }> }>
}

export type OpenApiOperation = {
  tags?: string[]
  summary?: string
  description?: string
  parameters?: OpenApiParameter[]
  responses?: Record<number, OpenApiResponse>
  requestBody?: unknown
  [key: string]: unknown
}

const jsonError = (description: string, error: string): OpenApiResponse => ({
  description,
  content: { 'application/json': { examples: { Error: { value: { error: { code: error, message: description } } } } } }
})

export const UNAUTHORIZED_RESPONSE = jsonError('Authentication credentials were not provided or are invalid.', 'UNAUTHORIZED')
export const FORBIDDEN_RESPONSE = jsonError("You don't have the required permissions.", 'FORBIDDEN')
export const NOT_FOUND_RESPONSE = jsonError('The requested resource was not found.', 'NOT_FOUND')

export const WORKSPACE_SLUG_PARAMETER: OpenApiParameter = {
  name: 'slug',
  in: 'path',
  required: true,
  description: 'The unique slug of the workspace.',
  schema: { type: 'string', example: 'my-workspace' }
}

export const PROJECT_ID_PARAMETER: OpenApiParameter = {
  name: 'projectId',
  in: 'path',
  required: true,
  description: 'The ID of the project.',
  schema: { type: 'integer', example: 1 }
}

export const CURSOR_PARAMETER: OpenApiParameter = {
  name: 'cursor',
  in: 'query',
  description: 'Pagination cursor in the form `page_size:page:0`.',
  schema: { type: 'string', example: '20:0:0' }
}

export const PER_PAGE_PARAMETER: OpenApiParameter = {
  name: 'per_page',
  in: 'query',
  description: 'Number of results per page (1 to 1000).',
  schema: { type: 'integer', example: 20 }
}

/** Plane `APIKeyAuthenticationExtension.get_security_definition`. */
export const apiKeySecurityScheme = {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  description: 'API key authentication. Provide your API key in the X-API-Key header.'
} as const

/**
 * Plane `_merge_schema_options`: `responses` and `parameters` in `overrides` are merged into the defaults,
 * every other key replaces the default.
 */
export function mergeSchemaOptions(defaults: OpenApiOperation, overrides: OpenApiOperation): OpenApiOperation {
  const { responses, parameters, ...rest } = overrides
  return {
    ...defaults,
    ...rest,
    responses: { ...defaults.responses, ...responses },
    parameters: [...(defaults.parameters ?? []), ...(parameters ?? [])]
  }
}

const SCOPED_RESPONSES = { 401: UNAUTHORIZED_RESPONSE, 403: FORBIDDEN_RESPONSE, 404: NOT_FOUND_RESPONSE }
const WORKSPACE = [WORKSPACE_SLUG_PARAMETER]
const PROJECT = [WORKSPACE_SLUG_PARAMETER, PROJECT_ID_PARAMETER]

function docs(tags: string[], parameters: OpenApiParameter[], responses: Record<number, OpenApiResponse>) {
  return (overrides: OpenApiOperation = {}): OpenApiOperation => mergeSchemaOptions({ tags, parameters, responses }, overrides)
}

export const userDocs = docs(['Users'], [], { 401: UNAUTHORIZED_RESPONSE })
export const workspaceDocs = docs(['Workspaces'], WORKSPACE, SCOPED_RESPONSES)
export const projectDocs = docs(['Projects'], WORKSPACE, SCOPED_RESPONSES)
export const cycleDocs = docs(['Cycles'], PROJECT, SCOPED_RESPONSES)
export const issueDocs = docs(['Work Items'], PROJECT, SCOPED_RESPONSES)
export const intakeDocs = docs(['Intake'], PROJECT, SCOPED_RESPONSES)
export const assetDocs = docs(['Assets'], [], { 401: UNAUTHORIZED_RESPONSE, 403: FORBIDDEN_RESPONSE })
export const workItemDocs = docs(['Work Items'], PROJECT, SCOPED_RESPONSES)
export const labelDocs = docs(['Labels'], PROJECT, SCOPED_RESPONSES)
export const issueLinkDocs = docs(['Work Item Links'], PROJECT, SCOPED_RESPONSES)
export const issueCommentDocs = docs(['Work Item Comments'], PROJECT, SCOPED_RESPONSES)
export const issueActivityDocs = docs(['Work Item Activity'], PROJECT, SCOPED_RESPONSES)
export const issueAttachmentDocs = docs(['Work Item Attachments'], PROJECT, SCOPED_RESPONSES)
export const workItemRelationDocs = docs(['Work Item Relations'], PROJECT, SCOPED_RESPONSES)
export const moduleDocs = docs(['Modules'], PROJECT, SCOPED_RESPONSES)
export const moduleIssueDocs = docs(['Modules'], PROJECT, SCOPED_RESPONSES)
export const stateDocs = docs(['States'], PROJECT, SCOPED_RESPONSES)
export const stickyDocs = docs(['Stickies'], WORKSPACE, SCOPED_RESPONSES)
export const estimateDocs = docs(['Estimates'], PROJECT, SCOPED_RESPONSES)
export const estimatePointDocs = docs(['Estimate Points'], PROJECT, SCOPED_RESPONSES)

/** Example payloads by schema name. Domain modules add theirs with `registerSchemaExample`. */
const SAMPLE_GENERIC = { id: 1, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const schemaExamples = new Map<string, unknown>()

export function registerSchemaExample(schemaName: string, sample: unknown): void {
  schemaExamples.set(schemaName, sample)
}

/**
 * Plane `get_sample_for_schema`: `PaginatedIssueResponse` resolves to the `Issue` sample, any unknown
 * schema to a generic record.
 */
export function getSampleForSchema(schemaName: string): unknown {
  const name = schemaName.startsWith('Paginated') ? schemaName.replace('Paginated', '').replace('Response', '') : schemaName
  return schemaExamples.get(name) ?? SAMPLE_GENERIC
}

/** Plane `create_paginated_response`: the paginated list body with an example built from the item sample. */
export function createPaginatedResponse(
  itemSchema: unknown,
  schemaName: string,
  description = 'Paginated results',
  exampleName = 'Paginated Response'
): OpenApiResponse {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            grouped_by: { type: 'string', nullable: true },
            sub_grouped_by: { type: 'string', nullable: true },
            total_count: { type: 'integer' },
            next_cursor: { type: 'string' },
            prev_cursor: { type: 'string' },
            next_page_results: { type: 'boolean' },
            prev_page_results: { type: 'boolean' },
            count: { type: 'integer' },
            total_pages: { type: 'integer' },
            total_results: { type: 'integer' },
            extra_stats: { type: 'string', nullable: true },
            results: { type: 'array', items: itemSchema }
          }
        },
        examples: {
          [exampleName]: {
            value: {
              grouped_by: 'state',
              sub_grouped_by: 'priority',
              total_count: 150,
              next_cursor: '20:1:0',
              prev_cursor: '20:0:0',
              next_page_results: true,
              prev_page_results: false,
              count: 20,
              total_pages: 8,
              total_results: 150,
              extra_stats: null,
              results: [getSampleForSchema(schemaName)]
            }
          }
        }
      }
    }
  }
}

/** Plane `preprocess_filter_api_v1_paths`: keep `/api/v1/` paths, drop PUT operations and server-only paths. */
export function preprocessFilterApiV1Paths<T extends { path: string; method: string }>(endpoints: T[]): T[] {
  return endpoints.filter(
    ({ path, method }) => path.startsWith('/api/v1/') && method.toUpperCase() !== 'PUT' && !path.toLowerCase().includes('server')
  )
}

/** Plane `generate_operation_summary`: `Retrieve Issues`, `Archive Cycle`, `Transfer Cycle`, ... */
export function generateOperationSummary(method: string, path: string, tag: string): string {
  const parts = path.split('/').filter(part => part && !part.startsWith('{') && !part.startsWith(':'))
  const resource = parts.length ? titleCase(parts[parts.length - 1].replaceAll('-', ' ')) : tag
  const upper = method.toUpperCase()
  const singular = tag.replace(/s$/, '')
  if (path.toLowerCase().includes('archive')) {
    if (upper === 'POST') return `Archive ${singular}`
    if (upper === 'DELETE') return `Unarchive ${singular}`
  }
  if (path.toLowerCase().includes('transfer')) return `Transfer ${singular}`
  const summaries: Record<string, string> = {
    GET: `Retrieve ${resource}`,
    POST: `Create ${resource}`,
    PATCH: `Update ${resource}`,
    DELETE: `Delete ${resource}`
  }
  return summaries[upper] ?? `${upper} ${resource}`
}

function titleCase(text: string): string {
  return text.replace(/\w\S*/g, word => word[0].toUpperCase() + word.slice(1).toLowerCase())
}

export type OpenApiDocumentInput = {
  title: string
  version: string
  /** `path -> method -> operation`, paths in `{param}` form. */
  paths: Record<string, Record<string, OpenApiOperation>>
  description?: string
}

/** Assemble an OpenAPI 3.0.3 document with the API key security scheme. Serve it from a route as JSON. */
export function buildOpenApiDocument({ title, version, paths, description }: OpenApiDocumentInput) {
  return {
    openapi: '3.0.3',
    info: { title, version, ...(description ? { description } : {}) },
    paths,
    components: { securitySchemes: { ApiKeyAuthentication: apiKeySecurityScheme } },
    security: [{ ApiKeyAuthentication: [] }]
  }
}
