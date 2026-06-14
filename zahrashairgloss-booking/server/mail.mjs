import { randomUUID } from 'node:crypto';

const RESEND_API_URL = 'https://api.resend.com/emails';

const normalizeRecipient = (recipient) => String(recipient || '').trim();
const normalizeFrom = (from) => String(from || '').trim();
const makeMessageId = () => `<${randomUUID()}@zahrashairgloss.local>`;

async function sendViaResend({ apiKey, from, to, subject, text, html }) {
  if (!apiKey) throw new Error('RESEND_API_KEY fehlt.');
  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: normalizeFrom(from),
      to: Array.isArray(to) ? to.map(normalizeRecipient) : normalizeRecipient(to),
      subject,
      text,
      html,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Resend hat die Mail abgelehnt.');
  return { messageId: payload?.id || makeMessageId(), accepted: Array.isArray(to) ? to.map(normalizeRecipient) : [normalizeRecipient(to)] };
}

export function createMailTransportFromEnv(env = process.env, logger = console) {
  const transportMode = String(env.MAIL_TRANSPORT || (env.RESEND_API_KEY ? 'resend' : 'log')).toLowerCase();
  const from = env.MAIL_FROM || 'Zahrashairgloss <onboarding@resend.dev>';
  if (transportMode === 'log') {
    return {
      kind: 'log',
      from,
      async sendMail(message) {
        const line = `[mail:log] ${message.subject} -> ${message.to}`;
        if (typeof logger.info === 'function') logger.info(line);
        else if (typeof logger.log === 'function') logger.log(line);
        return { messageId: makeMessageId(), accepted: [normalizeRecipient(message.to)] };
      },
    };
  }
  if (transportMode !== 'resend') throw new Error(`Unbekannter Mail-Transport: ${transportMode}`);
  return {
    kind: 'resend',
    from,
    async sendMail(message) {
      return sendViaResend({
        apiKey: env.RESEND_API_KEY,
        from: message.from || from,
        to: message.to,
        subject: message.subject,
        text: message.text || message.body || '',
        html: message.html || undefined,
      });
    },
  };
}

export async function flushQueuedCustomerMessages(db, mailTransport, now = new Date()) {
  const queued = db.prepare(`
    SELECT id, booking_id AS bookingId, kind, channel, recipient, subject, body, send_after AS sendAfter, attempts
    FROM customer_messages
    WHERE sent_at IS NULL AND datetime(send_after) <= datetime(?) AND attempts < 5
    ORDER BY send_after, created_at
    LIMIT 20
  `).all(now.toISOString());
  let sent = 0;
  let failed = 0;
  for (const message of queued) {
    if (message.channel !== 'email') {
      db.prepare(`UPDATE customer_messages SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run('SMS-Versand ist noch nicht eingerichtet.', message.id);
      failed += 1;
      continue;
    }
    try {
      await mailTransport.sendMail({
        from: mailTransport.from,
        to: message.recipient,
        subject: message.subject,
        text: message.body,
      });
      db.prepare(`UPDATE customer_messages SET sent_at = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?`).run(now.toISOString(), message.id);
      sent += 1;
    } catch (error) {
      db.prepare(`UPDATE customer_messages SET attempts = attempts + 1, last_error = ? WHERE id = ?`).run(error?.message || 'Mailversand fehlgeschlagen.', message.id);
      failed += 1;
    }
  }
  return { sent, failed };
}
