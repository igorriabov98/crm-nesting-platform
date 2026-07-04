const FALLBACK_DOWNLOAD_NAME = 'download';

export function attachmentContentDisposition(fileName: string): string {
  const safeFileName = sanitizeHeaderFileName(fileName) || FALLBACK_DOWNLOAD_NAME;
  const fallbackFileName = toAsciiFallbackFileName(safeFileName);
  const encodedFileName = encodeRFC5987Value(safeFileName);

  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodedFileName}`;
}

export function isAsciiHeaderValue(value: string): boolean {
  return /^[\t\x20-\x7e]*$/.test(value);
}

function sanitizeHeaderFileName(fileName: string): string {
  return fileName
    .replace(/[/\\]/g, '_')
    .replace(/[\r\n"]/g, '')
    .trim();
}

function toAsciiFallbackFileName(fileName: string): string {
  const fallback = fileName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[%;]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  return fallback || FALLBACK_DOWNLOAD_NAME;
}

function encodeRFC5987Value(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
