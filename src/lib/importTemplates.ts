// Ringkasan read-only 1 import template (Purchase / Journal Entry) -- bentuk
// response GET .../import/templates (backend: sales_import_v1.ringkas_import_template).
// Dipakai modal Mapping Rules di tab Source Data.
export interface ImportTemplateSummary {
  id: string;
  client_code: string | null;
  file_type: string | null;
  sheet_name: string | null;
  header_row_index: number | null;
  data_start_row_index: number | null;
  header_columns: unknown[];
  format_type: string | null;
  description: string | null;
  delimiter: string | null;
  encoding: string | null;
  date_format: string | null;
  field_mapping: Record<string, string>;
  detected_by: string | null;
  created_at: string | null;
}
