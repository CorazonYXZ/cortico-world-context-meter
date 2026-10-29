export const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const EXPORT_CODES=['E_EXPORT_DATA','E_EXPORT_ARGS','E_EXPORT_INTERFACE','E_EXPORT_TRANSPORT','E_EXPORT_DOWNLOAD',
  'E_XLSX_BUSY','E_XLSX_START','E_XLSX_GENERATE','E_XLSX_TIMEOUT','E_XLSX_CANCELLED','E_XLSX_UNAVAILABLE'] as const;
export type ExportCode=typeof EXPORT_CODES[number];
export function exportCode(value:unknown,fallback:ExportCode):ExportCode {
  const message=value instanceof Error?value.message:'';
  return EXPORT_CODES.find(code=>new RegExp(`\\b${code}\\b`).test(message))??fallback;
}
export const OWNER_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
