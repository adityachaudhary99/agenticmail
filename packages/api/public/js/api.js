// Tiny fetch wrapper that injects the auth header. Every API call goes
// through here so the master key (or per-agent key) is applied
// consistently and errors surface as plain Error throws.
import { state, API_URL } from './state.js';

export async function apiGet(path, opts = {}) {
  const r = await fetch(`${API_URL}/api/agenticmail${path}`, {
    headers: { Authorization: `Bearer ${opts.agentKey ?? state.masterKey}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return await r.json();
}

export async function apiPost(path, body, opts = {}) {
  const r = await fetch(`${API_URL}/api/agenticmail${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.agentKey ?? state.masterKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return await r.json();
}

export async function apiPut(path, body, opts = {}) {
  const r = await fetch(`${API_URL}/api/agenticmail${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.agentKey ?? state.masterKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return await r.json();
}

export async function apiDelete(path, opts = {}) {
  const r = await fetch(`${API_URL}/api/agenticmail${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${opts.agentKey ?? state.masterKey}` },
  });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  // DELETE may return 204 No Content — guard against empty body.
  const text = await r.text();
  return text ? JSON.parse(text) : { ok: true };
}
