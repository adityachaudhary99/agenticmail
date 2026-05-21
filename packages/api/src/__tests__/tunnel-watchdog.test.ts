/**
 * tunnel-watchdog — unit-tests the failure detection + respawn
 * orchestration without spawning a real cloudflared. We replace
 * `fetch` (for the health ping) with a fake and observe events
 * via the injected `onEvent`. Respawn is exercised indirectly: we
 * just verify the watchdog reaches the dead-state, since the actual
 * spawn requires cloudflared on PATH and is covered by the live
 * smoke-test path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the tunnel state file location BEFORE importing the module — the
// module's TUNNEL_STATE_FILE is a constant baked at import time.
const FAKE_STATE_FILE = join(tmpdir(), `tunnel-watchdog-test-${Date.now()}.json`);
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => tmpdir() };
});

// Helper to load the module fresh against the mocked homedir.
async function loadModule() {
  vi.resetModules();
  const mod = await import('../tunnel-watchdog.js');
  return mod;
}

beforeEach(() => {
  // Place the fake state file where the (re-imported) module will read it.
  const dir = join(tmpdir(), '.agenticmail');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tunnelFile = join(dir, 'tunnel.json');
  writeFileSync(tunnelFile, JSON.stringify({
    pid: 99999,
    url: 'https://dead-tunnel.trycloudflare.com',
    port: 3829,
    startedAt: new Date().toISOString(),
  }));
});

afterEach(() => {
  const tunnelFile = join(tmpdir(), '.agenticmail', 'tunnel.json');
  try { unlinkSync(tunnelFile); } catch { /* ignore */ }
  vi.restoreAllMocks();
});

describe('tunnel-watchdog — failure detection', () => {
  it('emits tunnel-failed events on each failed ping, escalates to tunnel-dead at threshold', async () => {
    const { startTunnelWatchdog } = await loadModule();

    // Fake the global fetch — always fails. The watchdog should
    // count up to threshold then trip.
    const fetchSpy = vi.fn().mockRejectedValue(new Error('connect ENOTFOUND'));
    vi.stubGlobal('fetch', fetchSpy);

    const events: any[] = [];
    const fakeDb = {} as any;
    const fakeConfig = { masterKey: 'mk_test' } as any;

    // Use a very tight interval to keep the test fast. Threshold=2
    // to keep the test short; the production default is 3.
    const stop = startTunnelWatchdog(fakeDb, fakeConfig, {
      pingIntervalMs: 10,
      pingTimeoutMs: 5,
      failureThreshold: 2,
      onEvent: (e) => events.push(e),
      onError: () => { /* swallow */ },
    });

    // Wait for at least 2 ticks + the respawn-attempt window.
    await new Promise((r) => setTimeout(r, 200));
    stop();

    const failed = events.filter((e) => e.kind === 'tunnel-failed');
    const dead = events.filter((e) => e.kind === 'tunnel-dead');
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(dead.length).toBeGreaterThanOrEqual(1);
    expect(dead[0].url).toBe('https://dead-tunnel.trycloudflare.com');
  });

  it('resets the failure counter on a recovered tunnel', async () => {
    const { startTunnelWatchdog } = await loadModule();

    // Fail twice then recover.
    let calls = 0;
    const fetchSpy = vi.fn().mockImplementation(() => {
      calls += 1;
      if (calls <= 2) return Promise.reject(new Error('connect ENOTFOUND'));
      return Promise.resolve(new Response('ok', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchSpy);

    const events: any[] = [];
    const stop = startTunnelWatchdog({} as any, { masterKey: 'mk_test' } as any, {
      pingIntervalMs: 10,
      pingTimeoutMs: 5,
      failureThreshold: 5,  // high enough that recovery wins
      onEvent: (e) => events.push(e),
      onError: () => { /* swallow */ },
    });
    await new Promise((r) => setTimeout(r, 150));
    stop();

    // Failed events accumulated; THEN a healthy event when the
    // recovery happened and the counter was non-zero.
    const failed = events.filter((e) => e.kind === 'tunnel-failed');
    const healthy = events.filter((e) => e.kind === 'tunnel-healthy');
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(healthy.length).toBeGreaterThanOrEqual(1);
    // Never escalated to dead because threshold was high.
    expect(events.find((e) => e.kind === 'tunnel-dead')).toBeUndefined();
  });

  it('silently no-ops when there is no tunnel state file', async () => {
    // Clear the state file BEFORE the watchdog starts.
    const tunnelFile = join(tmpdir(), '.agenticmail', 'tunnel.json');
    try { unlinkSync(tunnelFile); } catch { /* ignore */ }

    const { startTunnelWatchdog } = await loadModule();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const events: any[] = [];
    const stop = startTunnelWatchdog({} as any, { masterKey: 'mk_test' } as any, {
      pingIntervalMs: 10,
      onEvent: (e) => events.push(e),
    });
    await new Promise((r) => setTimeout(r, 60));
    stop();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
