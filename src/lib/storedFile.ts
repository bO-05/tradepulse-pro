export interface StoredFileLike {
  url?: string | null;
  storageId?: string;
  textContent?: string;
}

/**
 * Resolves the URL that serves a project file's stored bytes: the Convex storage
 * URL when present, otherwise a served app document-router path. Never derives
 * content from the file name.
 */
export function resolveStoredFileUrl(file: StoredFileLike): string | null {
  if (file.url) return file.url;
  const storageId = file.storageId || "";
  if (storageId.startsWith("http") || storageId.startsWith("/")) return storageId;
  return null;
}

/**
 * True when a record is one of the seeded documents served from the app's
 * document router (no inline text stored, served path storageId).
 */
export function isServedArchiveRecord(file: StoredFileLike): boolean {
  const storageId = file.storageId || "";
  return (
    !file.textContent &&
    (storageId.startsWith("/specs/") ||
      storageId.startsWith("/drawings/") ||
      storageId.startsWith("/quotes/") ||
      storageId.startsWith("/insurance/"))
  );
}

export function resolveStoredFileText(file: StoredFileLike): string | null {
  if (file.textContent && file.textContent.trim().length > 0) return file.textContent;
  return null;
}