// Face ID / passkey sign-in (WebAuthn) against the ours-auth Edge Function.
// The session token lives in memory only: every open, and every return after a few minutes away, asks again.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js?v=15';

const FN = `${SUPABASE_URL}/functions/v1/ours-auth`;
const enc = (buf) => { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const dec = (str) => { const s = String(str).replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4)); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

export class AuthError extends Error { constructor(code, message, status, data = {}) { super(message || code); this.code = code; this.status = status; this.data = data; } }

export async function call(action, body = {}, timeoutMs = 20000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(FN, { method: 'POST', signal: ctrl.signal, cache: 'no-store', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY }, body: JSON.stringify({ action, ...body }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new AuthError(j.error || `http_${r.status}`, j.message, r.status, j);
    return j;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('network', "Couldn't reach the sign-in service. Check the connection and try again.");
  } finally { clearTimeout(t); }
}

export async function supported() {
  if (!window.PublicKeyCredential || !navigator.credentials) return { ok: false, why: "This browser can't use Face ID sign-in. Open Ours in Safari or Chrome." };
  try {
    const p = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!p) return { ok: false, why: 'This device has no Face ID, Touch ID or Windows Hello turned on.' };
  } catch {}
  return { ok: true };
}

const friendly = (e) => {
  if (e && e.name === 'NotAllowedError') return new AuthError('cancelled', 'Face ID was cancelled or timed out. Try again.');
  if (e && e.name === 'AbortError') return new AuthError('aborted', 'Face ID was stopped. Try again.');
  if (e && e.name === 'InvalidStateError') return new AuthError('exists', 'This device is already set up. Use Unlock with Face ID.');
  if (e && e.name === 'SecurityError') return new AuthError('security', 'Face ID only works on the real Ours address.');
  return e instanceof AuthError ? e : new AuthError('webauthn', (e && e.message) || 'Face ID did not work. Try again.');
};

// Register this device's platform passkey. Pass { key } (link key), { invite } (setup code) or { session } (already unlocked,
// e.g. with a backup code; oldSession is then signed out once Face ID is set up).
export async function enroll(name, { key, invite, session, oldSession } = {}) {
  const { challengeId, options: o } = await call('reg-options', { name, key, invite, session });
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      ...o, challenge: dec(o.challenge), user: { ...o.user, id: dec(o.user.id) },
      excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: dec(c.id) })),
    } });
  } catch (e) { throw friendly(e); }
  const r = cred.response;
  const response = {
    id: cred.id, rawId: enc(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: { clientDataJSON: enc(r.clientDataJSON), attestationObject: enc(r.attestationObject), transports: r.getTransports ? r.getTransports() : [] },
  };
  return call('reg-verify', { challengeId, response, oldSession });
}

// Face ID / Touch ID check with any Ours passkey on this device (discoverable credential).
// signal: lets a tap on the button take over from an automatic attempt that is still waiting.
export async function unlock({ signal } = {}) {
  const { challengeId, options: o } = await call('auth-options');
  if (signal && signal.aborted) throw new AuthError('aborted', 'Face ID was stopped. Try again.');
  let cred;
  try {
    cred = await navigator.credentials.get({ signal, publicKey: { challenge: dec(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: 'required', allowCredentials: [] } });
  } catch (e) { throw friendly(e); }
  const r = cred.response;
  const response = {
    id: cred.id, rawId: enc(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    response: { clientDataJSON: enc(r.clientDataJSON), authenticatorData: enc(r.authenticatorData), signature: enc(r.signature), userHandle: r.userHandle ? enc(r.userHandle) : undefined },
  };
  return call('auth-verify', { challengeId, response, wantsCodes: true });
}

// One-time backup code (the way in when Face ID can't be used). Rate limited on the server.
export const backupUnlock = (code) => call('backup-unlock', { code });
