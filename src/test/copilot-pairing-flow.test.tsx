import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, renderHook } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── Supabase RPC mock ──────────────────────────────────────────────
const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'driver-1' } } } }),
    },
  },
}));

// ── Other dependencies stubbed minimally ───────────────────────────
vi.mock('@/utils/persistence', () => ({
  probeLocalCampaign: () => Promise.resolve(false),
  destroyDatabase: () => Promise.resolve(),
}));

import { CopilotPanel } from '@/components/CopilotPanel';
import {
  claimDriverPairing,
  getStoredDriverToken,
  clearStoredDriverToken,
  useCopilotOperator,
} from '@/hooks/useCopilotSession';
import DriverMiniPage from '@/pages/DriverMiniPage';

const SESSION = {
  id: 'sess-1',
  segment_name: null, segment_id: null,
  destination_lat: null, destination_lng: null,
  status: 'waiting' as const, track_number: null,
  queue: [], cursor_index: 0, batch_number: 0, batch_url: null,
};

beforeEach(() => {
  rpcMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe('CopilotPanel — nueva URL de emparejamiento', () => {
  it('no genera URL legacy ?session= cuando no hay nonce', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <CopilotPanel
        session={SESSION as any}
        active
        onStart={async () => SESSION as any}
        onEnd={async () => {}}
        onGeneratePairing={async () => null}
      >
        <button>open</button>
      </CopilotPanel>
    );
    fireEvent.click(screen.getByText('open'));

    // No QR, no copy buttons available before nonce generation.
    expect(screen.queryByText(/Copiar mini/i)).toBeNull();
    expect(screen.queryByText(/Copiar completo/i)).toBeNull();
  });

  it('al generar pairing usa ?p= y nunca ?session=', async () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    const pairing = { nonce: 'abc123def456abc123def456', expires_at: new Date(Date.now() + 300_000).toISOString() };

    render(
      <CopilotPanel
        session={SESSION as any}
        active
        onStart={async () => SESSION as any}
        onEnd={async () => {}}
        onGeneratePairing={async () => pairing}
      >
        <button>open</button>
      </CopilotPanel>
    );

    fireEvent.click(screen.getByText('open'));
    fireEvent.click(screen.getByRole('button', { name: /Generar QR de emparejamiento/i }));

    await waitFor(() => screen.getByText(/Copiar mini/i));
    fireEvent.click(screen.getByRole('button', { name: /Copiar mini/i }));

    const copiedUrl = writeText.mock.calls[0]?.[0] as string;
    expect(copiedUrl).toContain(`p=${pairing.nonce}`);
    expect(copiedUrl).not.toContain('session=');
    expect(copiedUrl).not.toContain('undefined');
  });
});

describe('claimDriverPairing', () => {
  it('llama a claim_driver_pairing y guarda token en localStorage', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { driver_token: 'drv-token-xyz', session_id: 'sess-9' },
      error: null,
    });

    const res = await claimDriverPairing('nonce-xyz');
    expect(rpcMock).toHaveBeenCalledWith('claim_driver_pairing', { p_nonce: 'nonce-xyz' });
    expect(res).toEqual({ ok: true, driver_token: 'drv-token-xyz', session_id: 'sess-9' });

    expect(localStorage.getItem('vialroute_active_driver_session_id')).toBe('sess-9');
    expect(localStorage.getItem('vialroute_driver_token_sess-9')).toBe('drv-token-xyz');
    expect(getStoredDriverToken()).toEqual({ driver_token: 'drv-token-xyz', session_id: 'sess-9' });

    clearStoredDriverToken();
    expect(getStoredDriverToken()).toBeNull();
  });

  it('devuelve error clasificado si la RPC falla', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'fail' } });
    const res = await claimDriverPairing('bad');
    expect(res).toEqual({ ok: false, reason: 'unknown' });
    expect(localStorage.getItem('vialroute_active_driver_session_id')).toBeNull();
  });

  it('propaga reason role_not_allowed sin guardar token', async () => {
    rpcMock.mockResolvedValueOnce({ data: { status: 'error', reason: 'role_not_allowed' }, error: null });
    const res = await claimDriverPairing('nonce-role');
    expect(res).toEqual({ ok: false, reason: 'role_not_allowed' });
    expect(localStorage.getItem('vialroute_active_driver_session_id')).toBeNull();
  });
});

describe('useCopilotOperator — envío confirmado', () => {
  it('usa operator_send_batch e incrementa lote confirmado por backend', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'create_copilot_session') {
        return Promise.resolve({ data: { session_id: 'sess-op-1' }, error: null });
      }
      if (name === 'operator_get_session') {
        return Promise.resolve({ data: { ...SESSION, id: 'sess-op-1' }, error: null });
      }
      if (name === 'operator_send_batch') {
        return Promise.resolve({
          data: {
            ...SESSION,
            id: 'sess-op-1',
            status: 'navigating',
            queue: [{ segmentId: 's1', name: 'A', lat: 1, lng: 2 }],
            batch_url: 'https://maps.example/batch',
            batch_number: 1,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const { result } = renderHook(() => useCopilotOperator());
    await act(async () => { await result.current.createSession(); });
    let sendResult: Awaited<ReturnType<typeof result.current.pushQueue>> | undefined;
    await act(async () => {
      sendResult = await result.current.pushQueue([{ segmentId: 's1', name: 'A', lat: 1, lng: 2 }], 0, 'https://maps.example/batch');
    });

    expect(rpcMock).toHaveBeenCalledWith('operator_send_batch', expect.objectContaining({
      p_session_id: 'sess-op-1',
      p_batch_url: 'https://maps.example/batch',
    }));
    expect(sendResult?.ok).toBe(true);
    expect(sendResult?.session?.batch_number).toBe(1);
  });
});

describe('DriverMiniPage — flujo seguro', () => {
  it('SESIÓN FINALIZADA cuando driver_read_session devuelve status=ended', async () => {
    // Stored token exists -> page should call driver_read_session.
    localStorage.setItem('vialroute_active_driver_session_id', 'sess-1');
    localStorage.setItem('vialroute_driver_token_sess-1', 'drv-tok-1');

    rpcMock.mockResolvedValue({ data: { status: 'ended', session_id: 'sess-1' }, error: null });

    render(
      <MemoryRouter initialEntries={['/driver-mini']}>
        <Routes>
          <Route path="/driver-mini" element={<DriverMiniPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/SESIÓN FINALIZADA/i)).toBeInTheDocument();
    });
    expect(rpcMock).toHaveBeenCalledWith('driver_read_session', { p_driver_token: 'drv-tok-1' });
  });

  it('estado invalid_token muestra "Escanea un QR nuevo"', async () => {
    localStorage.setItem('vialroute_active_driver_session_id', 'sess-2');
    localStorage.setItem('vialroute_driver_token_sess-2', 'drv-tok-bad');

    rpcMock.mockResolvedValue({ data: { status: 'invalid_token' }, error: null });

    render(
      <MemoryRouter initialEntries={['/driver-mini']}>
        <Routes>
          <Route path="/driver-mini" element={<DriverMiniPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Escanea un QR nuevo/i)).toBeInTheDocument();
    });
  });

  it('botón amarillo abre Maps con noopener,noreferrer y marca la ruta como abierta', async () => {
    localStorage.setItem('vialroute_active_driver_session_id', 'sess-3');
    localStorage.setItem('vialroute_driver_token_sess-3', 'drv-tok-3');

    const sessionPayload = {
      id: 'sess-3', segment_name: null, segment_id: null,
      destination_lat: null, destination_lng: null,
      status: 'navigating', track_number: null,
      queue: [{ segmentId: 's1', name: 'A', lat: 0, lng: 0 }],
      cursor_index: 0, batch_number: 2, batch_url: 'https://maps.example/route',
    };

    rpcMock.mockImplementation((name: string) => {
      if (name === 'driver_read_session') {
        return Promise.resolve({ data: { status: 'ok', session_id: 'sess-3', session: sessionPayload }, error: null });
      }
      if (name === 'driver_mark_route_opened') {
        return Promise.resolve({ data: { ok: true }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(
      <MemoryRouter initialEntries={['/driver-mini']}>
        <Routes>
          <Route path="/driver-mini" element={<DriverMiniPage />} />
        </Routes>
      </MemoryRouter>
    );

    // Espera a que aparezca el botón "ACTUALIZAR RUTA" (batch nuevo > seenRev=0).
    const btn = await screen.findByRole('button', { name: /ACTUALIZAR/i });
    await act(async () => { fireEvent.click(btn); });

    expect(openSpy).toHaveBeenCalledWith('https://maps.example/route', '_blank', 'noopener,noreferrer');
    expect(rpcMock).toHaveBeenCalledWith('driver_mark_route_opened', { p_driver_token: 'drv-tok-3', p_batch_number: 2 });
    openSpy.mockRestore();
  });
});
