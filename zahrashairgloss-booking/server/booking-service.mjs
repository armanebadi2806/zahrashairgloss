import { randomUUID } from 'node:crypto';
import { cleanupExpiredHolds, cleanupExpiredPendingBookings } from './database.mjs';

const BERLIN_OFFSET = '+02:00';
export const TERMS_VERSION = 'deposit-2026-06-10-v1';
export const HOLD_MINUTES = 10;

const pad = (value) => String(value).padStart(2, '0');
const minutesOf = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
const timeOf = (total) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
const localIso = (date, time) => `${date}T${time}:00${BERLIN_OFFSET}`;

const REGULAR_SERVICE_IDS = new Set(['cut', 'gloss', 'gloss-cut', 'colour']);

function adminNotification(db, bookingId, type, title, message, createdAt = new Date().toISOString()) {
  db.prepare(`INSERT INTO notifications(id,booking_id,type,title,message,created_at) VALUES(?,?,?,?,?,?)`).run(
    randomUUID(), bookingId, type, title, message, createdAt,
  );
}

function queueCustomerMessage(
  db,
  {
    bookingId,
    kind,
    channel = 'email',
    recipient,
    subject,
    body,
    sendAfter = new Date().toISOString(),
    createdAt = new Date().toISOString(),
  },
) {
  db.prepare(`INSERT INTO customer_messages(id,booking_id,kind,channel,recipient,subject,body,send_after,created_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(
    randomUUID(), bookingId, kind, channel, recipient, subject, body, sendAfter, createdAt,
  );
}

function processReminderQueue(db, now = new Date()) {
  const startWindow = now.toISOString();
  const endWindow = new Date(now.getTime() + 24 * 60 * 60_000).toISOString();
  const dueBookings = db.prepare(`
    SELECT id, first_name AS firstName, last_name AS lastName, email, phone, starts_at AS startsAt, reminder_channel AS reminderChannel
    FROM bookings
    WHERE status='confirmed'
      AND confirmation_status='confirmed'
      AND reminder_queued_at IS NULL
      AND datetime(starts_at) > datetime(?)
      AND datetime(starts_at) <= datetime(?)
    ORDER BY starts_at
  `).all(startWindow, endWindow);
  for (const booking of dueBookings) {
    const sendAfter = new Date(new Date(booking.startsAt).getTime() - 24 * 60 * 60_000).toISOString();
    db.prepare(`UPDATE bookings SET reminder_queued_at=? WHERE id=? AND reminder_queued_at IS NULL`).run(now.toISOString(), booking.id);
    queueCustomerMessage(db, {
      bookingId: booking.id,
      kind: 'reminder_24h',
      channel: booking.reminderChannel || 'email',
      recipient: booking.reminderChannel === 'sms' ? booking.phone : booking.email,
      subject: 'Terminerinnerung von Zahrashairgloss',
      body: `${booking.firstName} ${booking.lastName}: Dein Termin bei Zahrashairgloss ist am ${booking.startsAt.slice(0, 10)} um ${booking.startsAt.slice(11, 16)} Uhr. Bitte denk an die Anzahlung, falls noch offen.`,
      sendAfter,
      createdAt: now.toISOString(),
    });
    adminNotification(
      db,
      booking.id,
      'reminder_queued',
      '24h-Erinnerung geplant',
      `${booking.firstName} ${booking.lastName} erhält eine Erinnerung per ${booking.reminderChannel || 'email'}.`,
      now.toISOString(),
    );
  }
}

function touchSchedulers(db, now = new Date()) {
  processReminderQueue(db, now);
}

function configuredSlots(serviceId, weekday) {
  const saturday = weekday === 6;
  if (serviceId === 'balayage') {
    return saturday
      ? [{ time: '09:30', duration: 240 }, { time: '13:30', duration: 210 }]
      : [{ time: '10:00', duration: 240 }, { time: '14:00', duration: 240 }];
  }
  if (REGULAR_SERVICE_IDS.has(serviceId)) {
    return saturday
      ? [{ time: '10:45', duration: 60 }, { time: '14:45', duration: 60 }]
      : [{ time: '11:30', duration: 60 }, { time: '15:30', duration: 60 }];
  }
  return [];
}

export function listServices(db) {
  return db.prepare(`SELECT id,name,short_name AS short,duration_minutes AS duration FROM services WHERE active=1 ORDER BY rowid`).all();
}

export function listBookableDates(db, { serviceId, from = new Date(), limit = 6, searchDays = 90 } = {}) {
  if (!serviceId) throw new Error('Bitte zuerst einen Service wählen.');
  cleanupExpiredPendingBookings(db, from);
  touchSchedulers(db, from);
  const weekdays = new Set(db.prepare('SELECT weekday FROM working_hours WHERE active=1').all().map((row) => row.weekday));
  const cursor = new Date(from); cursor.setUTCHours(12, 0, 0, 0);
  const dates = [];
  for (let i = 0; i < searchDays && dates.length < limit; i += 1) {
    const date = new Date(cursor); date.setUTCDate(cursor.getUTCDate() + i);
    const weekday = date.getUTCDay() || 7;
    if (!weekdays.has(weekday)) continue;
    const value = `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}`;
    if (listAvailableSlots(db, serviceId, value, from).length > 0) dates.push(value);
  }
  return dates;
}

export function listAvailableSlots(db, serviceId, date, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Ungültiges Datum.');
  cleanupExpiredHolds(db, now);
  cleanupExpiredPendingBookings(db, now);
  touchSchedulers(db, now);
  const service = db.prepare('SELECT duration_minutes AS duration FROM services WHERE id=? AND active=1').get(serviceId);
  if (!service) throw new Error('Unbekannter Service.');
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  const hours = db.prepare('SELECT opens_at,closes_at FROM working_hours WHERE weekday=? AND active=1').get(weekday);
  if (!hours) return [];
  const dayStart = localIso(date, '00:00'); const dayEnd = localIso(date, '23:59');
  const conflicts = [
    ...db.prepare(`SELECT starts_at,ends_at FROM bookings WHERE status='confirmed' AND starts_at BETWEEN ? AND ?`).all(dayStart,dayEnd),
    ...db.prepare(`SELECT starts_at,ends_at FROM holds WHERE status='active' AND expires_at>? AND starts_at BETWEEN ? AND ?`).all(now.toISOString(),dayStart,dayEnd),
    ...db.prepare(`SELECT starts_at,ends_at FROM blocked_periods WHERE starts_at < ? AND ends_at > ?`).all(dayEnd,dayStart),
  ];
  const slots = [];
  for (const configured of configuredSlots(serviceId, weekday)) {
    const start=minutesOf(configured.time); const time=configured.time;
    const startsAt=localIso(date,time); const endsAt=localIso(date,timeOf(start+configured.duration));
    if (new Date(startsAt) <= now) continue;
    if (!conflicts.some((item) => startsAt < item.ends_at && endsAt > item.starts_at)) slots.push(time);
  }
  return slots;
}

export function createHold(db, { serviceId, date, time }, now = new Date()) {
  cleanupExpiredHolds(db, now); db.exec('BEGIN IMMEDIATE');
  try {
    if (!listAvailableSlots(db, serviceId, date, now).includes(time)) throw new Error('Dieser Termin ist nicht mehr verfügbar.');
    const weekday=new Date(`${date}T12:00:00Z`).getUTCDay()||7;
    const configured=configuredSlots(serviceId,weekday).find((item)=>item.time===time);
    const start=minutesOf(time); const hold={
      id:randomUUID(), serviceId, startsAt:localIso(date,time), endsAt:localIso(date,timeOf(start+configured.duration)),
      expiresAt:new Date(now.getTime()+HOLD_MINUTES*60_000).toISOString(), createdAt:now.toISOString(),
    };
    db.prepare(`INSERT INTO holds(id,service_id,starts_at,ends_at,expires_at,created_at) VALUES(?,?,?,?,?,?)`)
      .run(hold.id,hold.serviceId,hold.startsAt,hold.endsAt,hold.expiresAt,hold.createdAt);
    db.exec('COMMIT'); return hold;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function releaseHold(db, holdId) {
  db.prepare(`UPDATE holds SET status='released' WHERE id=? AND status='active'`).run(holdId);
}

export function confirmDemoPayment(db, { holdId, customer, acceptedTermsVersion }, now = new Date()) {
  if (acceptedTermsVersion !== TERMS_VERSION) throw new Error('Die Anzahlungsbedingungen müssen bestätigt werden.');
  for (const field of ['firstName','lastName','email','phone']) if (!customer?.[field]?.trim()) throw new Error('Bitte alle Kontaktdaten vollständig ausfüllen.');
  cleanupExpiredHolds(db,now); db.exec('BEGIN IMMEDIATE');
  try {
    const hold=db.prepare(`SELECT * FROM holds WHERE id=? AND status='active' AND expires_at>?`).get(holdId,now.toISOString());
    if (!hold) throw new Error('Die Reservierung ist abgelaufen. Bitte wähle einen neuen Termin.');
    const booking={id:randomUUID(),paymentReference:`DEMO-${randomUUID()}`,createdAt:now.toISOString()};
    db.prepare(`INSERT INTO bookings(id,hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,status,deposit_cents,payment_status,confirmation_status,payment_reference,terms_version,terms_accepted_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'confirmed',3000,'pending','awaiting_payment',?,?,?,?)`).run(
      booking.id,hold.id,hold.service_id,hold.starts_at,hold.ends_at,customer.firstName.trim(),customer.lastName.trim(),
      customer.email.trim(),customer.phone.trim(),customer.note?.trim()||null,booking.paymentReference,acceptedTermsVersion,now.toISOString(),booking.createdAt);
    db.prepare(`UPDATE holds SET status='converted' WHERE id=?`).run(hold.id); db.exec('COMMIT');
    adminNotification(db, booking.id, 'new_booking', 'Neue Online-Buchung',
      `${customer.firstName.trim()} ${customer.lastName.trim()} hat einen Termin gebucht.`, now.toISOString());
    queueCustomerMessage(db, {
      bookingId: booking.id,
      kind: 'reservation_confirmation',
      channel: 'email',
      recipient: customer.email.trim(),
      subject: 'Deine Reservierung bei Zahrashairgloss',
      body: `${customer.firstName.trim()} ${customer.lastName.trim()}, deine Reservierung für ${hold.starts_at.slice(0, 10)} um ${hold.starts_at.slice(11, 16)} Uhr ist vorgemerkt. Die 30 € Anzahlung ist offen und muss innerhalb von 2 Stunden eingehen, sonst wird der Termin automatisch storniert.`,
      sendAfter: now.toISOString(),
      createdAt: now.toISOString(),
    });
    return {...booking,depositCents:3000,startsAt:hold.starts_at};
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function listBookings(db,date) {
  cleanupExpiredPendingBookings(db);
  touchSchedulers(db);
  return db.prepare(`SELECT b.id,b.starts_at AS startsAt,b.ends_at AS endsAt,b.first_name AS firstName,b.last_name AS lastName,
    b.payment_status AS paymentStatus,b.confirmation_status AS confirmationStatus,b.confirmed_at AS confirmedAt,
    b.reminder_queued_at AS reminderQueuedAt,b.reminder_channel AS reminderChannel,b.deposit_cents AS depositCents,
    s.name AS serviceName,s.duration_minutes AS duration
    FROM bookings b JOIN services s ON s.id=b.service_id WHERE b.status='confirmed' AND b.starts_at BETWEEN ? AND ? ORDER BY b.starts_at`)
    .all(localIso(date,'00:00'),localIso(date,'23:59'));
}

export function listBookingsRange(db,from,to) {
  cleanupExpiredPendingBookings(db);
  touchSchedulers(db);
  return db.prepare(`SELECT b.id,b.starts_at AS startsAt,b.ends_at AS endsAt,b.first_name AS firstName,b.last_name AS lastName,
    b.email,b.phone,b.note,b.status,b.payment_status AS paymentStatus,b.confirmation_status AS confirmationStatus,
    b.confirmed_at AS confirmedAt,b.reminder_queued_at AS reminderQueuedAt,b.reminder_channel AS reminderChannel,b.deposit_cents AS depositCents,
    s.id AS serviceId,s.name AS serviceName,s.short_name AS serviceShort,s.duration_minutes AS duration
    FROM bookings b JOIN services s ON s.id=b.service_id
    WHERE b.status='confirmed' AND b.starts_at < ? AND b.ends_at > ? ORDER BY b.starts_at`)
    .all(localIso(to,'23:59'),localIso(from,'00:00'));
}

export function listBlockedPeriods(db,from,to) {
  return db.prepare(`SELECT id,starts_at AS startsAt,ends_at AS endsAt,reason FROM blocked_periods
    WHERE starts_at < ? AND ends_at > ? ORDER BY starts_at`).all(localIso(to,'23:59'),localIso(from,'00:00'));
}

export function createBlockedPeriod(db,{date,reason='Frei'}) {
  cleanupExpiredPendingBookings(db);
  touchSchedulers(db);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw new Error('Bitte einen gültigen freien Tag wählen.');
  const existing=db.prepare(`SELECT COUNT(*) AS count FROM bookings WHERE status='confirmed' AND starts_at < ? AND ends_at > ?`)
    .get(localIso(date,'23:59'),localIso(date,'00:00')).count;
  if(existing)throw new Error('An diesem Tag bestehen bereits Termine. Bitte diese zuerst verschieben oder stornieren.');
  const result=db.prepare(`INSERT INTO blocked_periods(starts_at,ends_at,reason) VALUES(?,?,?)`)
    .run(localIso(date,'00:00'),localIso(date,'23:59'),reason.trim()||'Frei');
  return {id:Number(result.lastInsertRowid),date,reason:reason.trim()||'Frei'};
}

export function deleteBlockedPeriod(db,id) {
  db.prepare('DELETE FROM blocked_periods WHERE id=?').run(id);
}

export function createManualBooking(db,{serviceId,date,time,customer},now=new Date()) {
  for(const field of ['firstName','lastName'])if(!customer?.[field]?.trim())throw new Error('Vor- und Nachname sind erforderlich.');
  cleanupExpiredPendingBookings(db,now);
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!listAvailableSlots(db,serviceId,date,now).includes(time))throw new Error('Dieser Termin ist nicht mehr verfügbar.');
    const weekday=new Date(`${date}T12:00:00Z`).getUTCDay()||7;
    const configured=configuredSlots(serviceId,weekday).find((item)=>item.time===time);
    const start=minutesOf(time);const holdId=randomUUID();const bookingId=randomUUID();const createdAt=now.toISOString();
    db.prepare(`INSERT INTO holds(id,service_id,starts_at,ends_at,expires_at,created_at,status) VALUES(?,?,?,?,?,?,'converted')`)
      .run(holdId,serviceId,localIso(date,time),localIso(date,timeOf(start+configured.duration)),createdAt,createdAt);
    db.prepare(`INSERT INTO bookings(id,hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,status,deposit_cents,payment_status,confirmation_status,payment_reference,terms_version,terms_accepted_at,confirmed_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'confirmed',0,'manual','confirmed','MANUAL',?,?,?,?)`).run(
      bookingId,holdId,serviceId,localIso(date,time),localIso(date,timeOf(start+configured.duration)),
      customer.firstName.trim(),customer.lastName.trim(),customer.email?.trim()||'',customer.phone?.trim()||'',customer.note?.trim()||null,
      'manual-admin',createdAt,createdAt,createdAt);
    db.exec('COMMIT');return {id:bookingId};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function cancelBooking(db,id) {
  cleanupExpiredPendingBookings(db);
  const result=db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed'`).run(id);
  if(!result.changes)throw new Error('Termin wurde nicht gefunden.');
}

export function markBookingPaid(db,id,now=new Date()) {
  cleanupExpiredPendingBookings(db,now);
  const booking=db.prepare(`SELECT id, first_name AS firstName, last_name AS lastName, email, phone, starts_at AS startsAt, reminder_channel AS reminderChannel FROM bookings WHERE id=? AND status='confirmed' AND payment_status='pending'`).get(id);
  if(!booking)throw new Error('Die Anzahlung konnte nicht bestätigt werden.');
  const result=db.prepare(`UPDATE bookings SET payment_status='paid', confirmation_status='confirmed', confirmed_at=? WHERE id=? AND status='confirmed' AND payment_status='pending'`).run(now.toISOString(), id);
  if(!result.changes)throw new Error('Die Anzahlung konnte nicht bestätigt werden.');
  adminNotification(db, id, 'payment_confirmed', 'Anzahlung bestätigt',
    `${booking.firstName} ${booking.lastName} wurde als bezahlt markiert.`, now.toISOString());
  queueCustomerMessage(db, {
    bookingId: id,
    kind: 'final_confirmation',
    channel: 'email',
    recipient: booking.email,
    subject: 'Dein Termin ist jetzt bestätigt',
    body: `${booking.firstName} ${booking.lastName}, danke! Deine Anzahlung ist eingegangen. Dein Termin am ${booking.startsAt.slice(0, 10)} um ${booking.startsAt.slice(11, 16)} Uhr ist jetzt final bestätigt.`,
    sendAfter: now.toISOString(),
    createdAt: now.toISOString(),
  });
  touchSchedulers(db, now);
}

export function rescheduleBooking(db,id,{date,time},now=new Date()) {
  cleanupExpiredPendingBookings(db,now);
  db.exec('BEGIN IMMEDIATE');
  try{
    const booking=db.prepare(`SELECT id,service_id AS serviceId FROM bookings WHERE id=? AND status='confirmed'`).get(id);
    if(!booking)throw new Error('Termin wurde nicht gefunden.');
    db.prepare(`UPDATE bookings SET status='moving' WHERE id=?`).run(id);
    if(!listAvailableSlots(db,booking.serviceId,date,now).includes(time))throw new Error('Der neue Termin ist nicht mehr verfügbar.');
    const weekday=new Date(`${date}T12:00:00Z`).getUTCDay()||7;
    const configured=configuredSlots(booking.serviceId,weekday).find((item)=>item.time===time);
    const start=minutesOf(time);
    db.prepare(`UPDATE bookings SET starts_at=?,ends_at=?,status='confirmed' WHERE id=?`)
      .run(localIso(date,time),localIso(date,timeOf(start+configured.duration)),id);
    db.exec('COMMIT');return {id,startsAt:localIso(date,time)};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function listNotifications(db) {
  cleanupExpiredPendingBookings(db);
  touchSchedulers(db);
  return db.prepare(`SELECT id,booking_id AS bookingId,type,title,message,read_at AS readAt,created_at AS createdAt
    FROM notifications ORDER BY created_at DESC LIMIT 30`).all();
}

export function markNotificationsRead(db) {
  db.prepare(`UPDATE notifications SET read_at=? WHERE read_at IS NULL`).run(new Date().toISOString());
}
