import { attachmentFileError, attachmentMimeFor } from '@pm/shared';
import { describe, expect, it } from 'vitest';
import { contentDisposition } from '../../lib/storage.js';
import { matchesSignature } from './file-signature.js';

const b = (s: string | number[]) =>
  typeof s === 'string' ? new TextEncoder().encode(s) : new Uint8Array(s);

describe('attachment validation (ADR-004)', () => {
  it('maps only allowed extensions, case-insensitively', () => {
    expect(attachmentMimeFor('A.PNG')).toBe('image/png');
    expect(attachmentMimeFor('archive.tar.zip')).toBe('application/zip');
    expect(attachmentMimeFor('x.svg')).toBeNull();
    expect(attachmentMimeFor('constructor')).toBeNull();
    expect(attachmentFileError('a.md', 1, 'text/plain')).toMatch(/does not match/);
    expect(attachmentFileError('a.md', 10 * 1024 * 1024 + 1, 'text/markdown')).toMatch(/10 MB/);
  });

  it('accepts UTF-8 text cut mid-character only when the sample is truncated', () => {
    const cut = b('caf\xc3'.split('').map((c) => c.charCodeAt(0)));
    expect(matchesSignature('text/plain', cut, true)).toBe(true);
    expect(matchesSignature('text/plain', cut, false)).toBe(false);
    expect(matchesSignature('text/plain', b('a\u0000b'), false)).toBe(false);
    expect(matchesSignature('text/csv', b('%PDF-1.4'), false)).toBe(false);
  });

  it('requires the WEBP marker after RIFF', () => {
    expect(matchesSignature('image/webp', b('RIFF\0\0\0\0WAVE'), false)).toBe(false);
    expect(matchesSignature('image/webp', b('RIFF\0\0\0\0WEBP'), false)).toBe(true);
  });

  it('builds an attachment Content-Disposition with a safe ASCII fallback', () => {
    expect(contentDisposition('résumé "v2".pdf')).toBe(
      `attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`,
    );
  });
});
