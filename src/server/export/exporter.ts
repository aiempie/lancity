import { serializeRows, type ExportSchemaDefinition } from '@/server/export/base'
import {
  CsvFormatter,
  CsvSchemaFormatter,
  JsonFormatter,
  JsonSchemaFormatter,
  XlsxFormatter,
  XlsxSchemaFormatter,
  type ExportRecord,
  type FormatOptions,
  type FormatResult,
  type PorterFormatter,
  type SchemaFormatter
} from '@/server/export/formatters'

/** `Exporter` of `plane/utils/exporters/exporter.py`: declared schema in, named file out. */
export class Exporter {
  private static formatters: Record<string, new () => SchemaFormatter> = {
    csv: CsvSchemaFormatter,
    json: JsonSchemaFormatter,
    xlsx: XlsxSchemaFormatter
  }
  readonly formatter: SchemaFormatter

  /** PD-1732 `__init__`. */
  constructor(
    readonly formatType: string,
    readonly schema: ExportSchemaDefinition<never, never>,
    readonly options: FormatOptions = {}
  ) {
    const formatter = Exporter.formatters[formatType]
    if (!formatter) throw new Error(`Unsupported format: ${formatType}. Available: ${Exporter.getAvailableFormats().join(', ')}`)
    this.formatter = new formatter()
  }

  /** PD-1733 `export`: records that are already serialized. */
  export(filename: string, records: ExportRecord[], fields?: string[]): Promise<FormatResult> {
    return this.formatter.format(filename, records, this.schema, { ...this.options, ...(fields?.length ? { fields } : {}) })
  }

  /** PD-1733 `export` for rows that still need the schema (the queryset branch of the Python method). */
  async exportRows<T>(filename: string, rows: T[], fields?: string[], deps?: unknown): Promise<FormatResult> {
    const records = await serializeRows(this.schema as unknown as ExportSchemaDefinition<T, unknown>, rows, fields, deps)
    return this.export(filename, records, fields)
  }

  /** PD-1734 `get_available_formats`. */
  static getAvailableFormats(): string[] {
    return Object.keys(Exporter.formatters)
  }

  /** PD-1735 `register_formatter`. */
  static registerFormatter(formatType: string, formatter: new () => SchemaFormatter): void {
    Exporter.formatters[formatType] = formatter
  }
}

export type RowSerializer<T> = (rows: T[]) => ExportRecord[] | Promise<ExportRecord[]>

/** `DataExporter` of `plane/utils/porters/exporter.py`: a serializer function replaces the DRF serializer class. */
export class DataExporter<T = unknown> {
  private static formatters: Record<string, new () => PorterFormatter> = {
    csv: CsvFormatter,
    json: JsonFormatter,
    xlsx: XlsxFormatter
  }
  readonly formatter: PorterFormatter | null = null

  /** PD-1980 `__init__`. */
  constructor(
    readonly serializer: RowSerializer<T>,
    readonly formatType?: string
  ) {
    if (formatType) {
      if (!DataExporter.formatters[formatType]) {
        throw new Error(`Unsupported format: ${formatType}. Available: ${DataExporter.getAvailableFormats().join(', ')}`)
      }
      this.formatter = this.createFormatter(formatType)
    }
  }

  /** PD-1981 `_create_formatter`: XLSX joins lists with `", "`. */
  createFormatter(formatType: string): PorterFormatter {
    const formatter = DataExporter.formatters[formatType]
    return formatType === 'xlsx' ? new XlsxFormatter(true, ', ') : new formatter()
  }

  /** PD-1982 `serialize`. */
  serialize(rows: T[]): Promise<ExportRecord[]> | ExportRecord[] {
    return this.serializer(rows)
  }

  /** PD-1983 `export`: `[filename.ext, content]`. */
  async export(filename: string, rows: T[]): Promise<FormatResult> {
    if (!this.formatter) throw new Error('format_type must be provided during initialization to use export() method')
    const content = await this.formatter.encode(await this.serialize(rows))
    return [`${filename}.${this.formatter.extension}`, content]
  }

  /** PD-1984 `to_string`. */
  async toString(rows: T[], formatter: PorterFormatter): Promise<string | Uint8Array> {
    return formatter.encode(await this.serialize(rows))
  }

  /** PD-1985 `to_file`: Workers have no local disk, so the result is a Web `File` instead of a path. */
  async toFile(rows: T[], filename: string, formatter: PorterFormatter): Promise<File> {
    const content = await this.toString(rows, formatter)
    return new File([content as BlobPart], `${filename}.${formatter.extension}`)
  }

  /** PD-1986 `get_available_formats`. */
  static getAvailableFormats(): string[] {
    return Object.keys(DataExporter.formatters)
  }
}
