import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('MCP Telegram tool dispatch', () => {
  let handleToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.AGENTICMAIL_API_URL = 'http://api.test';
    process.env.AGENTICMAIL_API_KEY = 'ak_test';
    ({ handleToolCall } = await import('../tools.js'));
  }, 15_000);

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers a Telegram bot through the agent-scoped setup endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, bot: { id: 7, username: 'demo_bot' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = JSON.parse(await handleToolCall('telegram_setup', {
      botToken: '123456789:AA-token',
      operatorChatId: '424242',
    }));

    expect(result).toEqual({ success: true, bot: { id: 7, username: 'demo_bot' } });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/agenticmail/telegram/setup', expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer ak_test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botToken: '123456789:AA-token',
        operatorChatId: '424242',
      }),
    }));
  });

  it('sends a Telegram message through the agent-scoped send endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    const result = JSON.parse(await handleToolCall('telegram_send', {
      chatId: '424242',
      text: 'hello from the agent',
    }));

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/agenticmail/telegram/send', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ chatId: '424242', text: 'hello from the agent' }),
    }));
  });

  it('polls Telegram updates through the poll endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, fetched: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = JSON.parse(await handleToolCall('telegram_poll', {}));

    expect(result).toEqual({ success: true, fetched: 0 });
    expect(fetchMock).toHaveBeenCalledWith('http://api.test/api/agenticmail/telegram/poll', expect.objectContaining({
      method: 'POST',
    }));
  });
});

describe('MCP phone transport — Twilio provider', () => {
  let handleToolCall: (name: string, args: Record<string, unknown>) => Promise<string>;

  beforeAll(async () => {
    vi.resetModules();
    process.env.AGENTICMAIL_API_URL = 'http://api.test';
    process.env.AGENTICMAIL_API_KEY = 'ak_test';
    ({ handleToolCall } = await import('../tools.js'));
  }, 15_000);

  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('forwards Twilio accountSid/authToken to the phone transport setup endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);

    await handleToolCall('phone_transport_setup', {
      provider: 'twilio',
      phoneNumber: '+12125551234',
      accountSid: 'ACxxxxxxxx',
      authToken: 'twilio-auth-token',
      webhookBaseUrl: 'https://public.example.com',
      webhookSecret: 'a'.repeat(24),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.provider).toBe('twilio');
    expect(body.accountSid).toBe('ACxxxxxxxx');
    expect(body.authToken).toBe('twilio-auth-token');
  });
});
