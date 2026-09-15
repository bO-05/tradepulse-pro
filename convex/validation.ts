export const DEFAULT_GENERAL_CONTRACTOR = "Austin Commercial, LP";
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const UPLOAD_FILE_TYPES = [
  "blueprint",
  "spec",
  "quote_pdf",
  "coi_certificate",
  "addendum",
] as const;

const CSI_DIVISION_PATTERN = /^\d{2} \d{2} \d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeCsiDivision(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function validateCsiDivision(value: string): string {
  const normalized = normalizeCsiDivision(value);
  if (!CSI_DIVISION_PATTERN.test(normalized)) {
    throw new Error("CSI division must use the format NN NN NN, for example 26 00 00.");
  }
  return normalized;
}

export function validatePositiveAmount(value: number, label: string, maximum = 1_000_000_000): number {
  if (!Number.isFinite(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be greater than zero and no more than $${maximum.toLocaleString()}.`);
  }
  return value;
}

export function validateNonNegativeAmount(value: number, label: string, maximum = 1_000_000_000): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be zero or greater and no more than $${maximum.toLocaleString()}.`);
  }
  return value;
}

export function validatePositiveInteger(value: number, label: string, maximum: number): number {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a whole number between 1 and ${maximum}.`);
  }
  return value;
}

export function validateBidDeadline(value: string, now = Date.now()): string {
  if (!DATE_PATTERN.test(value)) {
    throw new Error("Bid deadline must be a valid date in YYYY-MM-DD format.");
  }

  const deadlineDate = new Date(`${value}T23:59:59.999Z`);
  const [year, month, day] = value.split("-").map(Number);
  if (
    !Number.isFinite(deadlineDate.getTime()) ||
    deadlineDate.getUTCFullYear() !== year ||
    deadlineDate.getUTCMonth() + 1 !== month ||
    deadlineDate.getUTCDate() !== day
  ) {
    throw new Error("Bid deadline must be a valid calendar date.");
  }
  const deadline = deadlineDate.getTime();
  if (!Number.isFinite(deadline)) {
    throw new Error("Bid deadline must be a valid calendar date.");
  }

  const today = new Date(now);
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (deadline < todayUtc) {
    throw new Error("Bid deadline cannot be in the past.");
  }

  return value;
}

export function validateProjectText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > 500) throw new Error(`${label} must be 500 characters or fewer.`);
  return normalized;
}

export function validateEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("A valid contact email is required.");
  }
  return normalized;
}

export function validateUploadFileName(fileName: string, allowGeneratedMarkdown = false): string {
  const normalized = fileName.trim();
  if (!normalized || normalized.length > 255 || /[\\/\0-\x1F\x7F]/.test(normalized)) {
    throw new Error("File name must be a safe file name of 255 characters or fewer.");
  }
  const extension = normalized.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  const allowedExtensions = allowGeneratedMarkdown
    ? [".pdf", ".dwg", ".dxf", ".txt", ".md"]
    : [".pdf", ".dwg", ".dxf", ".txt"];
  if (!normalized || !extension || !allowedExtensions.includes(extension)) {
    throw new Error("Unsupported file type. Upload PDF, DWG, DXF, or TXT files only.");
  }
  return normalized;
}

export function validateUploadFileType(fileType: string): string {
  if (!UPLOAD_FILE_TYPES.includes(fileType as (typeof UPLOAD_FILE_TYPES)[number])) {
    throw new Error("Unsupported project file category.");
  }
  return fileType;
}

export function validateUploadContentType(fileName: string, contentType?: string): void {
  if (!contentType || contentType === "application/octet-stream") return;
  const extension = fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  const allowedByExtension: Record<string, string[]> = {
    ".pdf": ["application/pdf"],
    ".txt": ["text/plain", "text/csv"],
    ".dwg": ["application/acad", "image/vnd.dwg", "application/dwg"],
    ".dxf": ["application/dxf", "image/vnd.dxf"],
    ".md": ["text/markdown", "text/plain"],
  };
  if (extension && allowedByExtension[extension] && !allowedByExtension[extension].includes(contentType)) {
    throw new Error(`The uploaded content type ${contentType} does not match ${extension}.`);
  }
}
