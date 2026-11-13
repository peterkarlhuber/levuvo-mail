import nodemailer from 'nodemailer';
import { findSentFolder } from './send-utils.mjs';

// Compose exactly once so the MIME submitted by SMTP is the same copy saved via IMAP.
export async function composeRawEmail(from, data, { headers = {}, keepBcc = false } = {}) {
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const result = await composer.sendMail({
    from,
    to: data.to,
    cc: data.cc,
    // Bcc never appears in the sent MIME; submitEmail() passes it in the SMTP envelope only.
    ...(keepBcc ? { bcc: data.bcc } : {}),
    subject: data.subject,
    text: data.text,
    ...(data.html ? { html: data.html } : {}),
    ...(data.inReplyTo ? { inReplyTo: data.inReplyTo, references: data.references || data.inReplyTo } : {}),
    attachments: data.attachments,
    attachDataUrls: true,
    headers: { 'X-Mailer': 'Levuvo Mail', ...headers },
    keepBcc,
    disableFileAccess: true,
    disableUrlAccess: true
  });
  return result.message;
}

export function createSmtpTransport(smtp) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    requireTLS: smtp.port === 587,
    auth: smtp.accessToken
      ? { type: 'OAuth2', user: smtp.user, accessToken: smtp.accessToken }
      : { user: smtp.user, pass: smtp.password },
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}

export async function submitEmail(smtp, data, raw, transport = createSmtpTransport(smtp)) {
  const recipients = [...new Set([...data.to, ...data.cc, ...data.bcc].map(v => v.toLowerCase()))];
  try {
    const response = await transport.sendMail({
      raw,
      envelope: { from: smtp.user, to: recipients },
      disableFileAccess: true,
      disableUrlAccess: true
    });
    return {
      accepted: response.accepted || [],
      rejected: response.rejected || []
    };
  } finally {
    transport.close?.();
  }
}

// Return structured diagnostics: a successfully delivered SMTP message can
// still fail to be copied to IMAP. This function NEVER performs SMTP retries.
export async function appendToSent(withImap, raw, preferredPath = '') {
  let phase = 'connect';
  let folder = null;
  try {
    return await withImap(async client => {
      phase = 'list';
      const folders = await client.list();
      const selected = findSentFolder(folders, preferredPath);
      if (!selected) {
        return {
          saved: false,
          folder: null,
          reason: preferredPath ? 'configured_folder_not_found' : 'sent_folder_not_found'
        };
      }
      folder = selected.path;
      phase = 'append';
      const result = await client.append(folder, raw, ['\\Seen'], new Date());
      if (result === false || result == null) {
        return { saved: false, folder, reason: 'append_rejected' };
      }
      return { saved: true, folder, reason: null };
    });
  } catch {
    // Do not expose raw IMAP responses or account information to the browser.
    return { saved: false, folder, reason: phase === 'append' ? 'append_failed' : 'imap_failed' };
  }
}
