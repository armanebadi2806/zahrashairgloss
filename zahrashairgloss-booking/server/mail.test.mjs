import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './database.mjs';
import { TERMS_VERSION, confirmDemoPayment, createHold, markBookingPaid } from './booking-service.mjs';
import { createMailTransportFromEnv, flushQueuedCustomerMessages } from './mail.mjs';

const now = new Date('2026-06-10T11:00:00.000Z');

test('queued customer messages are flushed and marked as sent', async () => {
  const db = createDatabase(':memory:');
  const hold = createHold(db, { serviceId: 'cut', date: '2026-06-11', time: '11:30' }, now);
  const booking = confirmDemoPayment(db, {
    holdId: hold.id,
    acceptedTermsVersion: TERMS_VERSION,
    customer: { firstName: 'Anna', lastName: 'Sommer', email: 'anna@example.de', phone: '+491234' },
  }, now);
  markBookingPaid(db, booking.id, now);

  const sent = [];
  const transport = {
    from: 'Zahrashairgloss <no-reply@example.com>',
    async sendMail(message) {
      sent.push(message);
      return { accepted: [message.to], messageId: 'test-message-id' };
    },
  };

  const result = await flushQueuedCustomerMessages(db, transport, now);
  assert.equal(result.sent, 4);
  assert.equal(result.failed, 0);
  assert.equal(sent.length, 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM customer_messages WHERE sent_at IS NOT NULL').get().count, 4);
});

test('resend transport posts the expected payload', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ id: 'email_123' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  try {
    const transport = createMailTransportFromEnv({
      MAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 're_123',
      MAIL_FROM: 'Zahrashairgloss <onboarding@resend.dev>',
    });
    const result = await transport.sendMail({
      to: 'anna@example.de',
      subject: 'Termin bestätigt',
      text: 'Dein Termin ist bestätigt.',
    });
    assert.equal(result.messageId, 'email_123');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://api.resend.com/emails');
    assert.equal(requests[0].init.method, 'POST');
    const body = JSON.parse(requests[0].init.body);
    assert.equal(body.subject, 'Termin bestätigt');
    assert.equal(body.to, 'anna@example.de');
    assert.equal(body.from, 'Zahrashairgloss <onboarding@resend.dev>');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
