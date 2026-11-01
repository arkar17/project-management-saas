import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubApi } from '../../test-utils';
import { IssueAttachments } from './issue-attachments';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const iid = '33333333-3333-4333-8333-333333333333';
const uploader = { id: '44444444-4444-4444-8444-444444444444', name: 'Mo' };
const existing = {
  id: '66666666-6666-4666-8666-666666666666',
  filename: 'spec.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2.5 * 1024 * 1024,
  uploader,
  createdAt: '2026-10-24T00:00:00Z',
};

function mount(canUpload: boolean, routes: Record<string, unknown> = {}) {
  const fetchMock = stubApi({
    [`/issues/${iid}/attachments`]: { attachments: [existing] },
    ...routes,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <IssueAttachments issueId={iid} canUpload={canUpload} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;
const posts = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

/** Records the signed PUT and lets the test drive progress and completion. */
class FakeXhr {
  static last: FakeXhr | null = null;
  upload: {
    onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;
  } = {};
  headers: Record<string, string> = {};
  method = '';
  url = '';
  status = 0;
  onload?: () => void;
  onerror?: () => void;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {}
}

describe('IssueAttachments (FR-ISS-006)', () => {
  it('lists name, type, size, uploader and date; read-only users get no drop zone', async () => {
    mount(false);
    expect(await screen.findByText('spec.pdf')).toBeTruthy();
    expect(screen.getByText(/PDF · 2\.5 MB · Mo/)).toBeTruthy();
    expect(screen.queryByText('Choose files')).toBeNull();
    expect(screen.getByLabelText('Download spec.pdf')).toBeTruthy();
  });

  it('rejects oversized and disallowed files before any request is made', async () => {
    const fetchMock = mount(true);
    await screen.findByText('spec.pdf');
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(fileInput(), {
      target: { files: [big, new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByText('File is larger than 10 MB')).toBeTruthy();
    expect(screen.getByText('.svg files are not allowed')).toBeTruthy();
    expect(posts(fetchMock)).toHaveLength(0);
  });

  it('initiates, PUTs with the signed headers showing progress, then confirms', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    const upload = {
      uploadId: '77777777-7777-4777-8777-777777777777',
      url: 'http://storage.local/b/ws/x/att/77777777',
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain', 'x-amz-meta-issue': iid },
      expiresAt: '',
    };
    const fetchMock = mount(true, {
      [`/auth/csrf`]: { csrfToken: 't' },
      [`/issues/${iid}/attachments/confirm`]: { attachment: { ...existing, id: upload.uploadId } },
    });
    await screen.findByText('spec.pdf');
    // Initiation shares the list path; answer the POST with the signed upload.
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ csrfToken: 't' })));
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ upload }), { status: 201 }),
    );
    fireEvent.drop(screen.getByText('or drag them here').parentElement!, {
      dataTransfer: { files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(FakeXhr.last?.url).toBe(upload.url));
    const xhr = FakeXhr.last!;
    expect(xhr.method).toBe('PUT');
    expect(xhr.headers).toEqual(upload.headers);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 });
    expect(await screen.findByText('50%')).toBeTruthy();
    xhr.status = 200;
    xhr.onload?.();
    await waitFor(() =>
      expect(posts(fetchMock).map(([url]) => url)).toContain(
        `/api/v1/issues/${iid}/attachments/confirm`,
      ),
    );
    const init = posts(fetchMock).find(([url]) => url === `/api/v1/issues/${iid}/attachments`)!;
    expect(JSON.parse(String(init[1]!.body))).toEqual({
      filename: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: 5,
    });
  });

  it('shows the API error when a download is refused', async () => {
    mount(false);
    fireEvent.click(await screen.findByLabelText('Download spec.pdf'));
    expect(await screen.findByText('x')).toBeTruthy();
  });
});
