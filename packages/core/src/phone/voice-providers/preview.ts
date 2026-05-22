/**
 * Voice-runtime preview — play a short audio sample of a voice through
 * the host's speakers.
 *
 * Used by the interactive `agenticmail setup-voice` picker so the
 * operator can HEAR each voice before committing to an install-wide
 * default — and by `agenticmail persona --voice <name> --preview` for
 * per-agent picks too.
 *
 * How it works:
 *
 *   1. Open a short-lived WebSocket against the provider's realtime
 *      endpoint (the same `wss://api.openai.com/v1/realtime` /
 *      `wss://api.x.ai/v1/realtime` URL the call bridge uses).
 *   2. Send a `session.update` configuring the picked voice and
 *      requesting PCM 16-bit / 24 kHz / mono output.
 *   3. Send a `response.create` with instruction-only override that
 *      asks the model to read a short canned phrase.
 *   4. Accumulate `response.audio.delta` (base-64 PCM) until
 *      `response.done`.
 *   5. Wrap the PCM in a minimal RIFF / WAVE header and write to a
 *      temp file.
 *   6. Spawn `afplay` (macOS) / `aplay` (Linux) / fall back to
 *      printing the path on Windows.
 *
 * Cost per preview is well under a cent (5–8 s of realtime output).
 * The whole round-trip typically completes in under 4 s.
 */

import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { getVoiceProvider } from './registry.js';

/** PCM sample rate used by the realtime API for `format: { type: 'audio/pcm' }`. */
export const PREVIEW_SAMPLE_RATE = 24_000;

export interface VoicePreviewOptions {
  /** Provider id (`'openai'`, `'grok'`, …). */
  providerId: string;
  /** Voice name from the provider's catalogue (or a custom voice id). */
  voice: string;
  /** Resolved API key — caller is expected to have already loaded this. */
  apiKey: string;
  /** Override the phrase the model speaks. */
  text?: string;
  /** Overall timeout before bailing on a stuck session. Default 20 s. */
  timeoutMs?: number;
  /** Optional model override (defaults to the provider's `defaultModel`). */
  model?: string;
}

export interface VoicePreviewResult {
  /** Absolute path to the playable WAV file. */
  wavPath: string;
  /** How long the round-trip took, end-to-end. */
  durationMs: number;
  /** How many audio bytes the provider sent (post-decode, raw PCM). */
  pcmBytes: number;
}

/**
 * Stream a short audio sample for `voice` through the provider's
 * realtime endpoint and return the path to a playable WAV. Throws on
 * timeout, auth failure, or unknown provider.
 *
 * Read-only against the provider — no calls placed, nothing persisted
 * beyond the temp WAV file the caller can delete after playing.
 */
export async function previewVoice(opts: VoicePreviewOptions): Promise<VoicePreviewResult> {
  const provider = getVoiceProvider(opts.providerId);
  if (!provider) {
    throw new Error(`Unknown voice provider "${opts.providerId}"`);
  }
  const model = (opts.model || provider.defaultModel).trim();
  const voice = (opts.voice || provider.defaultVoice).trim();
  const text = (opts.text && opts.text.trim())
    || `Hi, I'm ${voice}. This is how I'll sound on your calls.`;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const url = `${provider.websocketBaseUrl}?model=${encodeURIComponent(model)}`;

  return new Promise<VoicePreviewResult>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${opts.apiKey}` },
    });
    const audioChunks: Buffer[] = [];
    const startedAt = Date.now();
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      fn();
    };
    const timer = setTimeout(() => {
      settle(() => reject(new Error(
        `Voice preview timed out after ${timeoutMs}ms `
        + `(got ${audioChunks.length} audio frame(s) before the deadline)`,
      )));
    }, timeoutMs);

    ws.on('open', () => {
      // 1. Configure session with the picked voice + raw PCM output.
      //    output_modalities is "audio" only — we don't want text
      //    coming back, just speech.
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          model,
          output_modalities: ['audio'],
          audio: {
            output: {
              // PCM 16-bit / 24 kHz / mono — what afplay + aplay
              // expect, and what the realtime API streams natively.
              // `rate` became a required field in late-2026 server
              // updates; specifying it explicitly is forward-compatible.
              format: { type: 'audio/pcm', rate: PREVIEW_SAMPLE_RATE },
              voice,
            },
          },
        },
      }));
      // 2. Trigger a one-shot response. `instructions` is the
      //    realtime API's per-response override of the session-level
      //    instructions — perfect for a fire-and-forget sample.
      ws.send(JSON.stringify({
        type: 'response.create',
        response: {
          instructions:
            `Say the following exactly, with natural friendly intonation, `
            + `then stop: "${text}". Do not add greetings, do not paraphrase, `
            + `do not say anything else.`,
        },
      }));
    });

    ws.on('message', (data: WebSocket.RawData) => {
      let event: { type?: string; delta?: unknown; error?: unknown };
      try {
        event = JSON.parse(data.toString());
      } catch {
        return; // ignore malformed frames
      }
      // Audio chunks arrive on response.output_audio.delta (modern
      // gpt-realtime) and response.audio.delta (some older builds).
      // Accept both for compatibility with future protocol shifts.
      if (
        (event.type === 'response.output_audio.delta'
          || event.type === 'response.audio.delta')
        && typeof event.delta === 'string'
      ) {
        audioChunks.push(Buffer.from(event.delta, 'base64'));
        return;
      }
      // Done — close + return.
      if (
        event.type === 'response.done'
        || event.type === 'response.completed'
        || event.type === 'response.output_audio.done'
      ) {
        clearTimeout(timer);
        settle(() => {
          if (audioChunks.length === 0) {
            reject(new Error(
              'Preview ended without any audio frames — likely an empty response '
              + 'from the provider. Check API key + voice name.',
            ));
            return;
          }
          const pcm = Buffer.concat(audioChunks);
          const wavPath = join(
            tmpdir(),
            `agenticmail-voice-preview-${provider.id}-${voice}-${Date.now()}.wav`,
          );
          writeFileSync(wavPath, wrapPcm16AsWav(pcm, PREVIEW_SAMPLE_RATE, 1));
          resolve({
            wavPath,
            durationMs: Date.now() - startedAt,
            pcmBytes: pcm.length,
          });
        });
        return;
      }
      // Hard error from the provider (bad voice id, missing entitlement, …).
      if (event.type === 'error') {
        const err = event.error as { message?: string } | undefined;
        const msg = (err && err.message) || JSON.stringify(event.error);
        clearTimeout(timer);
        settle(() => reject(new Error(`${provider.displayName} preview error: ${msg}`)));
      }
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(err));
    });
    ws.on('close', () => {
      // If we close without ever getting a `done` event AND haven't
      // already settled, treat as an early disconnect.
      if (!settled) {
        clearTimeout(timer);
        settle(() => reject(new Error(
          `Preview socket closed before completion `
          + `(got ${audioChunks.length} frame(s))`,
        )));
      }
    });
  });
}

/**
 * Play a WAV file through the host's default audio device.
 * Best-effort: macOS uses `afplay`, Linux uses `aplay`, Windows falls
 * back to printing the path. Resolves when playback exits.
 */
export function playWav(wavPath: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let player: string;
    let args: string[];
    switch (process.platform) {
      case 'darwin':
        player = 'afplay';
        args = [wavPath];
        break;
      case 'linux':
        player = 'aplay';
        args = ['-q', wavPath];
        break;
      default:
        // eslint-disable-next-line no-console
        console.log(
          `[preview] No bundled audio player for ${process.platform}. `
          + `Open this file manually: ${wavPath}`,
        );
        resolve();
        return;
    }
    const child = spawn(player, args, { stdio: 'ignore' });
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`${player} exited with code ${code}`));
    });
    child.on('error', (err) => {
      // Player not installed (e.g. headless server). Fall back to logging.
      // eslint-disable-next-line no-console
      console.log(
        `[preview] Could not launch ${player} (${err.message}). `
        + `Open manually: ${wavPath}`,
      );
      resolve();
    });
  });
}

/**
 * Minimal RIFF/WAVE header for 16-bit PCM. The realtime API streams
 * raw little-endian PCM samples; we just need a 44-byte WAV header
 * so `afplay`/`aplay`/any standard player can open the result.
 */
function wrapPcm16AsWav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);              // PCM fmt chunk length
  header.writeUInt16LE(1, 20);               // PCM format (linear)
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
