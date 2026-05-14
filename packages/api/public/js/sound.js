// Notification sound — soft 2-note chime synthesised via Web Audio
// API (no external asset shipped, zero network cost). User
// preference (on/off) lives in localStorage.
//
// Why Web Audio and not an <audio src="...">: the asset would have
// to be bundled (cache invalidation, MIME types, paths under
// `/branding/`, etc.), and we'd still need code to gate playback
// on a user-toggle. Synthesizing a chime is one short function
// with no asset surface and lets us tweak the timbre by editing
// numbers.

const STORAGE_KEY = 'agenticmail.notif.soundEnabled';

/** True if the user has the chime turned on. Defaults to true. */
export function isSoundEnabled() {
  // null = never set → default ON. 'false' string = explicitly off.
  return localStorage.getItem(STORAGE_KEY) !== 'false';
}

/** Persist the user's choice. */
export function setSoundEnabled(enabled) {
  try { localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false'); } catch { /* private mode */ }
}

/**
 * Play the new-mail chime. Two short sine pulses an octave apart
 * (E5 → A5), 220 ms total, gain envelope quick attack + 60 ms
 * decay so it reads as a soft "ding" rather than a buzz. Bails
 * silently when sound is disabled or the browser blocks audio
 * (e.g. tab hasn't received a user gesture yet — first arrival
 * after a page load with no interaction may be muted by the
 * autoplay policy; subsequent arrivals work).
 */
export function playNotificationSound() {
  if (!isSoundEnabled()) return;
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    const playTone = (freq, startOffset, duration = 0.08) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = now + startOffset;
      // Quick attack + exponential decay = "chime" not "beep".
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration);
    };
    playTone(659.25, 0);     // E5
    playTone(880.00, 0.12);  // A5 — major sixth above
    // Close the context shortly after the tones end so we don't
    // leak audio contexts. Some browsers cap at ~6 concurrent.
    setTimeout(() => { try { ctx.close(); } catch {} }, 600);
  } catch { /* audio blocked; user-toggle is still respected */ }
}
