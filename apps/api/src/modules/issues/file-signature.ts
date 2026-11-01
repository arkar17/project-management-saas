import type { AttachmentMimeType } from '@pm/shared';

/** Bytes read from the start of an upload for content sniffing (ADR-004). */
export const SNIFF_BYTES = 4096;

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0) =>
  bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

const BINARY: Record<Exclude<AttachmentMimeType, `text/${string}`>, (b: Uint8Array) => boolean> = {
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/gif': (b) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a')),
  'image/webp': (b) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8),
  'application/pdf': (b) => startsWith(b, ascii('%PDF-')),
  // Local file header, or the end-of-central-directory record of an empty archive.
  'application/zip': (b) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]),
};

/**
 * Text types have no magic number: accept only valid UTF-8 without NUL or other C0 control
 * bytes (tab, LF, CR and form feed aside), and nothing that sniffs as a known binary format.
 */
function isPlainText(bytes: Uint8Array, truncated: boolean): boolean {
  if (Object.values(BINARY).some((matches) => matches(bytes))) return false;
  for (const b of bytes) {
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0c && b !== 0x0d) return false;
    if (b === 0x7f) return false;
  }
  // A sample cut mid-character may end with up to three bytes of an incomplete sequence.
  for (let cut = 0; cut <= (truncated ? 3 : 0); cut++) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytes.length - cut));
      return true;
    } catch {
      // try a shorter sample
    }
  }
  return false;
}

/** True when the file's leading bytes are consistent with its declared MIME type. */
export function matchesSignature(
  mimeType: AttachmentMimeType,
  bytes: Uint8Array,
  truncated: boolean,
): boolean {
  if (mimeType.startsWith('text/')) return isPlainText(bytes, truncated);
  return BINARY[mimeType as keyof typeof BINARY](bytes);
}
