import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
  },
}));

import { useCopilotOperator } from '@/hooks/useCopilotSession';

const SESSION_KEY = 'vialroute_copilot_session_id';

beforeEach(() => {
  rpcMock.mockReset();
  try { sessionStorage.clear(); } catch { /* */ }
});

const fakeRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'sess-1',
  status: 'waiting',
  queue: [],
  cursor_index: 0,
  batch_number: 0,
  batch_url: null,
  ...overrides,
});

describe('useCopilotOperator — inicio (BUG-COPILOT-START-001)', () => {
  it('createSession ok → sessionOrigin = fresh_create, active=true, sessionStorage poblado', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'create_copilot_session') return Promise.resolve({ data: { session_id: 'sess-1' }, error: null });
      if (name === 'operator_get_session') return Promise.resolve({ data: fakeRow(), error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const { result } = renderHook(() => useCopilotOperator());
    await act(async () => { await result.current.createSession(); });
    expect(result.current.active).toBe(true);
    expect(result.current.sessionOrigin).toBe('fresh_create');
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('sess-1');
  });

  it('create_copilot_session falla → active=false, error claro, sin sessionStorage', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'create_copilot_session') return Promise.resolve({ data: null, error: { message: 'Role not allowed' } });
      return Promise.resolve({ data: null, error: null });
    });
    const { result } = renderHook(() => useCopilotOperator());
    await act(async () => {
      await expect(result.current.createSession()).rejects.toThrow(/rol operator\/admin/i);
    });
    expect(result.current.active).toBe(false);
    expect(result.current.sessionOrigin).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('Unauthorized → mensaje "Usuario no autenticado"', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'Unauthorized' } });
    const { result } = renderHook(() => useCopilotOperator());
    await act(async () => {
      await expect(result.current.createSession()).rejects.toThrow(/no autenticado/i);
    });
  });

  it('recover desde sessionStorage con sesión "ended" → limpia y origin=cleared_ended', async () => {
    sessionStorage.setItem(SESSION_KEY, 'sess-old');
    rpcMock.mockResolvedValue({ data: fakeRow({ id: 'sess-old', status: 'ended' }), error: null });
    const { result } = renderHook(() => useCopilotOperator());
    await waitFor(() => expect(result.current.sessionOrigin).toBe('cleared_ended'));
    expect(result.current.active).toBe(false);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('recover desde sessionStorage con RPC error → limpia y origin=cleared_invalid', async () => {
    sessionStorage.setItem(SESSION_KEY, 'sess-old');
    rpcMock.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const { result } = renderHook(() => useCopilotOperator());
    await waitFor(() => expect(result.current.sessionOrigin).toBe('cleared_invalid'));
    expect(result.current.active).toBe(false);
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('recover ok → origin=recovered_from_storage, active=true', async () => {
    sessionStorage.setItem(SESSION_KEY, 'sess-rec');
    rpcMock.mockResolvedValue({ data: fakeRow({ id: 'sess-rec', status: 'waiting' }), error: null });
    const { result } = renderHook(() => useCopilotOperator());
    await waitFor(() => expect(result.current.sessionOrigin).toBe('recovered_from_storage'));
    expect(result.current.active).toBe(true);
  });

  it('endSession resetea sessionOrigin a null y limpia storage', async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === 'create_copilot_session') return Promise.resolve({ data: { session_id: 'sess-1' }, error: null });
      if (name === 'operator_get_session') return Promise.resolve({ data: fakeRow(), error: null });
      if (name === 'operator_end_session') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    });
    const { result } = renderHook(() => useCopilotOperator());
    await act(async () => { await result.current.createSession(); });
    await act(async () => { await result.current.endSession(); });
    expect(result.current.active).toBe(false);
    expect(result.current.sessionOrigin).toBeNull();
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
