import cyclesSeed from '@/server/maintenance/seed/cycles.json'
import issuesSeed from '@/server/maintenance/seed/issues.json'
import labelsSeed from '@/server/maintenance/seed/labels.json'
import modulesSeed from '@/server/maintenance/seed/modules.json'
import pagesSeed from '@/server/maintenance/seed/pages.json'
import projectsSeed from '@/server/maintenance/seed/projects.json'
import statesSeed from '@/server/maintenance/seed/states.json'
import viewsSeed from '@/server/maintenance/seed/views.json'

type Json = Record<string, unknown>

const SEED_FILES: Record<string, unknown[]> = {
  'projects.json': projectsSeed,
  'states.json': statesSeed,
  'labels.json': labelsSeed,
  'issues.json': issuesSeed,
  'pages.json': pagesSeed,
  'cycles.json': cyclesSeed,
  'modules.json': modulesSeed,
  'views.json': viewsSeed
}

/** PD-1238 `read_seed_file`: the bundled seed rows, or null for an unknown file. Files are imported, not read at run time. */
export function readSeedFile<T = Json>(filename: string): T[] | null {
  const rows = SEED_FILES[filename]
  return rows ? (structuredClone(rows) as T[]) : null
}

/** pages.json stores `logo_props` as a JSON string or as a Python dict repr (single quotes, True/False/None). */
export function parseLooseJson(value: unknown): Json {
  if (value && typeof value === 'object') return value as Json
  if (typeof value !== 'string' || !value.trim()) return {}
  for (const text of [value, value.replaceAll("'", '"').replaceAll('True', 'true').replaceAll('False', 'false').replaceAll('None', 'null')]) {
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed === 'object') return parsed as Json
    } catch {
      // try the next form
    }
  }
  return {}
}

/** Project name and identifier derived from the workspace name, like `create_project_and_member`. */
export function seedProjectNames(workspaceName: string) {
  const name =
    workspaceName
      .replace(/[&+,:;$^}{*=?@#|'<>.()%!-]/g, '')
      .trim()
      .slice(0, 255) || 'Workspace'
  const identifier =
    workspaceName
      .replace(/[^\p{L}\p{N}]/gu, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 5) || 'PROJ'
  return { name, identifier }
}
