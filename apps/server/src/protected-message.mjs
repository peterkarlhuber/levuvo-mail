// "Protect with password": the message (text, formatting, attachments) is encrypted with a
// password and sent as a self-contained HTML file. The recipient opens it in any browser and
// enters the password, which the sender shares on another channel (SMS, phone, Signal).
//
// Crypto: PBKDF2-HMAC-SHA256 (600 000 iterations, OWASP 2023) → AES-256-GCM. Both run in every
// current browser through WebCrypto, so no server, no account and no installation is needed.
// Nothing is stored by Levuvo; the password never leaves the sender's device in readable form.
import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'node:crypto';

export const PROTECTED_FILENAME = 'Geschuetzte-Nachricht.html';
export const PBKDF2_ITERATIONS = 600_000;
export const MAX_PROTECTED_BYTES = 5 * 1024 * 1024;
const MARKER = 'levuvo-protected';
const fail = (message, code = 'protected_invalid', statusCode = 400) => {
  throw Object.assign(new Error(message), { code, statusCode });
};

/** Checks the password options from the composer. */
export function readPasswordProtection(value) {
  if (!value || typeof value !== 'object') fail('Bitte ein Passwort festlegen.');
  const password = typeof value.password === 'string' ? value.password : '';
  if (password.length < 10) fail('Das Passwort muss mindestens 10 Zeichen lang sein.');
  if (password.length > 200) fail('Das Passwort ist zu lang (höchstens 200 Zeichen).');
  const hint = typeof value.hint === 'string' ? value.hint.trim() : '';
  if (hint.length > 120 || /[\r\n]/.test(hint)) fail('Der Passwort-Hinweis ist zu lang.');
  if (hint && hint.toLowerCase().includes(password.toLowerCase()))
    fail('Der Hinweis darf das Passwort nicht enthalten.');
  return { password, hint };
}

export function sealPayload(payload, password, { iterations = PBKDF2_ITERATIONS } = {}) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password.normalize('NFC'), salt, iterations, 32, 'sha256');
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iter: iterations,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    ct: ct.toString('base64')
  };
}

export function openPayload(box, password) {
  if (!box || box.v !== 1 || box.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(box.iter) || box.iter > 5_000_000)
    fail('Unbekanntes Format der geschützten Nachricht.');
  const key = pbkdf2Sync(String(password).normalize('NFC'), Buffer.from(box.salt, 'base64'), box.iter, 32, 'sha256');
  const data = Buffer.from(box.ct, 'base64');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    decipher.setAuthTag(data.subarray(data.length - 16));
    const plain = Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch {
    fail('Das Passwort ist falsch.', 'protected_wrong_password', 403);
  }
}

const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** Builds the payload and the HTML file the recipient opens. */
export function buildProtectedFile({ from, subject, html, text, attachments = [], date = new Date() }, protection) {
  let size = 0;
  const files = attachments.map(a => {
    const content = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content || '');
    size += content.length;
    return { name: a.filename, type: a.contentType || 'application/octet-stream', data: content.toString('base64') };
  });
  if (size > MAX_PROTECTED_BYTES)
    fail('Geschützte Nachrichten dürfen Anhänge bis zusammen 5 MiB enthalten.', 'protected_too_large');
  const payload = {
    v: 1,
    from: from?.name ? `${from.name} <${from.address}>` : from?.address || '',
    subject: subject || '',
    date: date.toISOString(),
    html: html || '',
    text: text || '',
    attachments: files
  };
  const box = sealPayload(payload, protection.password);
  return { box, file: viewerHtml(box, { sender: from?.name || from?.address || '', hint: protection.hint }) };
}

/** Finds the encrypted box in a received message (attachment created by buildProtectedFile). */
export function findProtectedBox(attachments = []) {
  for (const a of attachments) {
    if (!/\.html?$/i.test(a.filename || '') || !a.content) continue;
    const content = typeof a.content === 'string' ? a.content : Buffer.from(a.content).toString('utf8');
    if (content.length > 12 * 1024 * 1024 || !content.includes(MARKER)) continue;
    const m = content.match(/<script type="application\/json" id="levuvo-protected">([^<]+)<\/script>/);
    if (!m) continue;
    try {
      const box = JSON.parse(m[1]);
      if (box?.v === 1 && box.ct) {
        const hint = content.match(/<p id="hint"[^>]*data-hint="([^"]*)"/)?.[1] || '';
        return {
          box,
          hint: hint
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
        };
      }
    } catch {
      /* not ours */
    }
  }
  return null;
}

/** Notice in the visible e-mail (text and HTML). */
export function protectedNotice({ sender, hint }) {
  const text = [
    `${sender || 'Jemand'} hat dir eine mit Passwort geschützte Nachricht gesendet.`,
    '',
    `So öffnest du sie: Die angehängte Datei „${PROTECTED_FILENAME}“ speichern, im Browser öffnen und das Passwort eingeben, das du auf einem anderen Weg (z. B. per SMS oder Telefon) erhalten hast.`,
    ...(hint ? ['', `Hinweis zum Passwort: ${hint}`] : []),
    '',
    '—',
    `${sender || 'Someone'} sent you a password-protected message. Save the attached file “${PROTECTED_FILENAME}”, open it in your browser and enter the password you received on another channel.`,
    '',
    'Gesendet mit Levuvo Mail.'
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#141414;max-width:560px">
<p style="font-size:16px;font-weight:bold;margin:0 0 8px">🔒 ${esc(sender || 'Jemand')} hat dir eine geschützte Nachricht gesendet.</p>
<p style="margin:0 0 8px">So öffnest du sie: Die angehängte Datei <b>${esc(PROTECTED_FILENAME)}</b> speichern, im Browser öffnen und das Passwort eingeben, das du auf einem anderen Weg (z. B. per SMS oder Telefon) erhalten hast.</p>
${hint ? `<p style="margin:0 0 8px">Hinweis zum Passwort: <i>${esc(hint)}</i></p>` : ''}
<p style="margin:16px 0 0;color:#666;font-size:12px">${esc(sender || 'Someone')} sent you a password-protected message. Save the attached file, open it in your browser and enter the password you received on another channel.</p>
<p style="margin:12px 0 0;color:#888;font-size:12px">Gesendet mit Levuvo Mail.</p></div>`;
  return { text, html };
}

// The viewer runs in the recipient's browser: WebCrypto decryption, the message body in a
// sandboxed frame without scripts, attachments as downloads. No network access (CSP).
const VIEWER_SCRIPT = `(() => {
  const de = !/^en/i.test(navigator.language || '') || /^de/i.test(navigator.language || '');
  const T = de ? { wrong: 'Das Passwort ist falsch.', busy: 'Wird entschlüsselt …', old: 'Dieser Browser kann die Nachricht nicht öffnen. Bitte einen aktuellen Browser (Chrome, Edge, Firefox, Safari) verwenden.', from: 'Von', date: 'Datum', files: 'Anhänge', save: 'Speichern', open: 'Öffnen', lock: 'Nachricht wieder sperren' } : { wrong: 'Wrong password.', busy: 'Decrypting …', old: 'This browser cannot open the message. Please use a current browser (Chrome, Edge, Firefox, Safari).', from: 'From', date: 'Date', files: 'Attachments', save: 'Save', open: 'Open', lock: 'Lock message again' };
  if (!de) { for (const el of document.querySelectorAll('[data-en]')) el.textContent = el.dataset.en; document.documentElement.lang = 'en'; document.getElementById('pw').placeholder = 'Password'; }
  const box = JSON.parse(document.getElementById('levuvo-protected').textContent);
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const form = document.getElementById('unlock'); const err = document.getElementById('err'); const btn = document.getElementById('go');
  if (!window.crypto || !crypto.subtle) { err.textContent = T.old; btn.disabled = true; return; }
  form.addEventListener('submit', async ev => {
    ev.preventDefault(); err.textContent = ''; btn.disabled = true; const label = btn.textContent; btn.textContent = T.busy;
    try {
      const pw = new TextEncoder().encode(document.getElementById('pw').value.normalize('NFC'));
      const base = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(box.salt), iterations: box.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct));
      show(JSON.parse(new TextDecoder().decode(plain)));
    } catch (e) { err.textContent = T.wrong; document.getElementById('pw').select(); }
    finally { btn.disabled = false; btn.textContent = label; }
  });
  function show(m) {
    document.getElementById('locked').hidden = true;
    const view = document.getElementById('view'); view.hidden = false;
    document.getElementById('subject').textContent = m.subject || '';
    document.getElementById('meta').textContent = T.from + ': ' + m.from + ' · ' + T.date + ': ' + new Date(m.date).toLocaleString(de ? 'de-AT' : 'en-GB');
    const frame = document.getElementById('body');
    const css = '<style>body{font:15px/1.6 -apple-system,Segoe UI,Arial,sans-serif;color:#141414;margin:0;padding:4px;overflow-wrap:anywhere}img{max-width:100%;height:auto}pre{white-space:pre-wrap;font:inherit}</style>';
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    frame.srcdoc = '<!doctype html><meta charset="utf-8"><base target="_blank">' + css + (m.html || '<pre>' + esc(m.text || '') + '</pre>');
    frame.onload = () => { try { frame.style.height = Math.max(160, frame.contentDocument.documentElement.scrollHeight + 20) + 'px'; } catch (e) { frame.style.height = '60vh'; } };
    const list = document.getElementById('files'); list.textContent = '';
    if (m.attachments && m.attachments.length) {
      document.getElementById('fileshead').textContent = T.files; document.getElementById('fileshead').hidden = false;
      for (const f of m.attachments) {
        const blob = new Blob([b64(f.data)], { type: 'application/octet-stream' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; a.textContent = '⬇ ' + f.name + ' (' + Math.max(1, Math.round(blob.size / 1024)) + ' KB)';
        const li = document.createElement('li'); li.appendChild(a); list.appendChild(li);
      }
    }
    document.getElementById('relock').textContent = T.lock;
  }
  document.getElementById('relock').addEventListener('click', () => location.reload());
})();`;

function viewerHtml(box, { sender, hint }) {
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; frame-src 'self' about:; form-action 'none'; base-uri 'none'">
<meta name="robots" content="noindex">
<title>Geschützte Nachricht · Levuvo Mail</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#141414;font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 20px}
.card{background:#fff;border:1px solid #e3e3e3;border-radius:12px;padding:28px;box-shadow:0 10px 30px #0000000d}
h1{font-size:24px;letter-spacing:-.4px;margin:0 0 8px}p{margin:0 0 12px;color:#3b3b3b}
.lock{font-size:30px;margin-bottom:8px}
form{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}
input{flex:1;min-width:200px;font:inherit;padding:11px 12px;border:1px solid #cfcfcf;border-radius:8px}
input:focus{outline:2px solid #141414;outline-offset:1px}
button{font:inherit;font-weight:600;padding:11px 18px;border-radius:8px;border:0;background:#141414;color:#fff;cursor:pointer}
button:disabled{opacity:.6}
.err{color:#b42318;font-weight:600;min-height:1.5em;margin-top:10px}
.hint{font-size:14px;color:#5f5f5f}
small{color:#6f6f6f}
#subject{font-size:22px;margin:0 0 4px}#meta{font-size:13px;color:#6f6f6f;margin-bottom:16px}
iframe{width:100%;border:0;min-height:160px}
#files{padding-left:18px}#files a{color:#141414;font-weight:600}
.secondary{background:#f2f2f2;color:#141414;border:1px solid #e3e3e3;margin-top:16px}
footer{text-align:center;font-size:12px;color:#8c8c8c;margin-top:20px}
</style></head><body><main>
<section class="card" id="locked">
<div class="lock" aria-hidden="true">🔒</div>
<h1 data-en="Protected message">Geschützte Nachricht</h1>
<p data-en="${esc(sender)} sent you an encrypted message. Enter the password you received on another channel (e.g. SMS or phone).">${esc(sender)} hat dir eine verschlüsselte Nachricht gesendet. Gib das Passwort ein, das du auf einem anderen Weg erhalten hast (z. B. per SMS oder Telefon).</p>
${hint ? `<p id="hint" class="hint" data-hint="${esc(hint)}"><span data-en="Password hint:">Hinweis zum Passwort:</span> <i>${esc(hint)}</i></p>` : ''}
<form id="unlock" autocomplete="off"><input id="pw" type="password" placeholder="Passwort" autofocus required aria-label="Passwort"><button id="go" type="submit" data-en="Open">Öffnen</button></form>
<div class="err" id="err" role="alert"></div>
<noscript><p class="err">Bitte JavaScript erlauben bzw. die Datei in einem Browser öffnen. · Please open this file in a browser with JavaScript enabled.</p></noscript>
<small data-en="Decryption happens only in this browser. Nothing is sent over the internet.">Die Entschlüsselung passiert nur in diesem Browser. Es wird nichts übers Internet gesendet.</small>
</section>
<section class="card" id="view" hidden>
<h2 id="subject"></h2><div id="meta"></div>
<iframe id="body" sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin" title="Nachricht"></iframe>
<h3 id="fileshead" hidden></h3><ul id="files"></ul>
<button class="secondary" id="relock" type="button"></button>
</section>
<footer>Levuvo Mail · AES-256-GCM · PBKDF2-SHA256</footer>
</main>
<script type="application/json" id="${MARKER}">${JSON.stringify(box)}</script>
<script>${VIEWER_SCRIPT}</script>
</body></html>`;
}
