import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

/** Routes fetch calls by path to canned JSON responses (component tests only). */
export function stubApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    const path = url.replace('/api/v1', '').split('?')[0]!;
    const body = routes[path];
    if (body === undefined)
      return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'x', requestId: '' }), {
        status: 404,
      });
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function renderAt(path: string, pattern: string, element: ReactNode, children?: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={pattern} element={element}>
            {children}
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
