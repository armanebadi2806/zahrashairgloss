import { randomUUID } from 'node:crypto';
import { cleanupExpiredHolds, cleanupExpiredPendingBookings } from './database.mjs';

const BERLIN_OFFSET = '+02:00';
export const TERMS_VERSION = 'deposit-2026-06-10-v1';
export const HOLD_MINUTES = 10;
const ADMIN_NOTIFICATION_EMAIL = 'zahrashairgloas@gmail.com';

const pad = (value) => String(value).padStart(2, '0');
const minutesOf = (time) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
const timeOf = (total) => `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
const localIso = (date, time) => `${date}T${time}:00${BERLIN_OFFSET}`;
const isValidTime = (time) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(time || '');
const serviceLane = (serviceId) => serviceId === 'balayage' ? 'balayage' : 'regular';
const addDays = (date, days) => {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

const REGULAR_SERVICE_IDS = new Set(['cut', 'gloss', 'gloss-cut', 'colour']);
const WAITLIST_TIME_WINDOWS = new Set(['egal', 'vormittag', 'nachmittag']);

function adminNotification(db, bookingId, type, title, message, createdAt = new Date().toISOString(), details = {}) {
  db.prepare(`INSERT INTO notifications(id,booking_id,type,title,message,appointment_starts_at,service_name,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(
    randomUUID(), bookingId, type, title, message, details.appointmentStartsAt || null, details.serviceName || null, createdAt,
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
      body: `kurze Terminerinnerung:\n\nAdresse: Wandsbeker Marktstraße 159, 22041 Hamburg\nNimm bitte Bargeld mit🥺\n\nLg zahra💕`,
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

const normalizeEmail = (value) => value?.trim().toLowerCase() || '';
const normalizePhone = (value) => value?.trim() || '';
const bookingTimeWindow = (startsAt) => {
  const hour = Number(String(startsAt).slice(11, 13));
  return Number.isFinite(hour) && hour < 13 ? 'vormittag' : 'nachmittag';
};

function findCustomerProfile(db, { email = '', phone = '' }) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  if (normalizedEmail) {
    const profile = db.prepare(`
      SELECT id, first_name AS firstName, last_name AS lastName, email, phone,
        admin_note AS adminNote, preferences, created_at AS createdAt, updated_at AS updatedAt
      FROM customer_profiles
      WHERE lower(email)=?
    `).get(normalizedEmail);
    if (profile) return profile;
  }
  if (normalizedPhone) {
    return db.prepare(`
      SELECT id, first_name AS firstName, last_name AS lastName, email, phone,
        admin_note AS adminNote, preferences, created_at AS createdAt, updated_at AS updatedAt
      FROM customer_profiles
      WHERE phone=?
    `).get(normalizedPhone);
  }
  return null;
}

function ensureCustomerProfile(db, customer, now = new Date()) {
  const firstName = customer?.firstName?.trim();
  const lastName = customer?.lastName?.trim();
  if (!firstName || !lastName) return null;
  const email = normalizeEmail(customer.email);
  const phone = normalizePhone(customer.phone);
  const timestamp = now.toISOString();
  const existing = findCustomerProfile(db, { email, phone });
  if (existing) {
    db.prepare(`
      UPDATE customer_profiles
      SET first_name=?, last_name=?, email=?, phone=?, updated_at=?
      WHERE id=?
    `).run(firstName, lastName, email || existing.email || null, phone || existing.phone || null, timestamp, existing.id);
    return { ...existing, firstName, lastName, email: email || existing.email || '', phone: phone || existing.phone || '', updatedAt: timestamp };
  }
  const profile = {
    id: randomUUID(),
    firstName,
    lastName,
    email,
    phone,
    adminNote: '',
    preferences: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  db.prepare(`
    INSERT INTO customer_profiles(id, first_name, last_name, email, phone, admin_note, preferences, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(
    profile.id,
    profile.firstName,
    profile.lastName,
    profile.email || null,
    profile.phone || null,
    profile.adminNote,
    profile.preferences,
    profile.createdAt,
    profile.updatedAt,
  );
  return profile;
}

function matchingWaitlistCount(db, { serviceId, startsAt }) {
  const date = String(startsAt).slice(0, 10);
  const window = bookingTimeWindow(startsAt);
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM waitlist_entries
    WHERE status='active'
      AND service_id=?
      AND (preferred_date IS NULL OR preferred_date='' OR preferred_date=?)
      AND (time_window='egal' OR time_window=?)
  `).get(serviceId, date, window).count;
}

function serviceDurationMinutes(db, serviceId) {
  const service = db.prepare('SELECT duration_minutes AS duration FROM services WHERE id=? AND active=1').get(serviceId);
  if (!service) throw new Error('Unbekannter Service.');
  return service.duration;
}

function ensureNoAdminConflict(db, { serviceId, date, time, ignoreBookingId = null }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Bitte ein gültiges Datum wählen.');
  if (!isValidTime(time)) throw new Error('Bitte eine gültige Uhrzeit im Format HH:MM wählen.');
  const duration = serviceDurationMinutes(db, serviceId);
  const startsAt = localIso(date, time);
  const endsAt = localIso(date, timeOf(minutesOf(time) + duration));
  const lane = serviceLane(serviceId);
  const conflict = db.prepare(`
    SELECT b.id
    FROM bookings b
    JOIN services s ON s.id=b.service_id
    WHERE b.status='confirmed'
      AND (? IS NULL OR b.id<>?)
      AND (?='balayage' AND s.id='balayage' OR ?='regular' AND s.id<>'balayage')
      AND b.starts_at < ?
      AND b.ends_at > ?
    LIMIT 1
  `).get(ignoreBookingId, ignoreBookingId, lane, lane, endsAt, startsAt);
  if (conflict) throw new Error('Zu dieser Uhrzeit besteht bereits ein anderer Termin.');
  return { startsAt, endsAt };
}

function configuredSlots(serviceId, weekday) {
  const saturday = weekday === 6;
  if (serviceId === 'balayage') {
    return saturday
      ? [{ time: '09:30', duration: 240 }, { time: '13:30', duration: 210 }]
      : [{ time: '10:00', duration: 240 }, { time: '14:00', duration: 240 }];
  }
  if (serviceId === 'consultation') {
    return saturday
      ? [{ time: '10:45', duration: 30 }, { time: '14:45', duration: 30 }]
      : [{ time: '11:30', duration: 30 }, { time: '15:30', duration: 30 }];
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

export function listBookableDates(db, { serviceId, from = new Date(), limit = 12, searchDays = 90 } = {}) {
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
  const lane = serviceLane(serviceId);
  const dayStart = localIso(date, '00:00'); const dayEnd = localIso(date, '23:59');
  const conflicts = [
    ...db.prepare(`
      SELECT b.starts_at,b.ends_at
      FROM bookings b
      JOIN services s ON s.id=b.service_id
      WHERE b.status='confirmed'
        AND (?='balayage' AND s.id='balayage' OR ?='regular' AND s.id<>'balayage')
        AND b.starts_at BETWEEN ? AND ?
    `).all(lane, lane, dayStart, dayEnd),
    ...db.prepare(`
      SELECT h.starts_at,h.ends_at
      FROM holds h
      JOIN services s ON s.id=h.service_id
      WHERE h.status='active'
        AND h.expires_at>?
        AND (?='balayage' AND s.id='balayage' OR ?='regular' AND s.id<>'balayage')
        AND h.starts_at BETWEEN ? AND ?
    `).all(now.toISOString(), lane, lane, dayStart, dayEnd),
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
    const service = db.prepare('SELECT name FROM services WHERE id=?').get(hold.service_id);
    adminNotification(db, booking.id, 'new_booking', 'Neue Online-Buchung',
      `${customer.firstName.trim()} ${customer.lastName.trim()} hat einen Termin gebucht.`, now.toISOString(), {
        appointmentStartsAt: hold.starts_at,
        serviceName: service?.name,
      });
    queueCustomerMessage(db, {
      bookingId: booking.id,
      kind: 'reservation_confirmation',
      channel: 'email',
      recipient: customer.email.trim(),
      subject: 'Deine Reservierung bei Zahrashairgloss',
      body: `${customer.firstName.trim()} ${customer.lastName.trim()}, deine Reservierung für ${hold.starts_at.slice(0, 10)} um ${hold.starts_at.slice(11, 16)} Uhr ist vorgemerkt. Die 30 € Anzahlung ist noch offen. Bitte sende sie per PayPal, damit Zahra den Termin final bestätigen kann. Adresse: Wandsbeker Marktstraße 159, 22041 Hamburg.`,
      sendAfter: now.toISOString(),
      createdAt: now.toISOString(),
    });
    queueCustomerMessage(db, {
      bookingId: booking.id,
      kind: 'admin_new_booking',
      channel: 'email',
      recipient: ADMIN_NOTIFICATION_EMAIL,
      subject: 'Neue Terminbuchung bei Zahrashairgloss',
      body: `${customer.firstName.trim()} ${customer.lastName.trim()} hat einen neuen Termin fuer ${service?.name || 'einen Service'} am ${hold.starts_at.slice(0, 10)} um ${hold.starts_at.slice(11, 16)} Uhr gebucht. Anzahlung: 30 EUR offen.`,
      sendAfter: now.toISOString(),
      createdAt: now.toISOString(),
    });
    ensureCustomerProfile(db, customer, now);
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

export function createBlockedPeriod(db,{date,fromDate,toDate,reason='Frei'}) {
  cleanupExpiredPendingBookings(db);
  touchSchedulers(db);
  const startDate = fromDate || date;
  const endDate = toDate || date || fromDate;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate||'') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate||''))throw new Error('Bitte einen gültigen Zeitraum wählen.');
  if (startDate > endDate) throw new Error('Das Enddatum muss am selben Tag oder nach dem Startdatum liegen.');
  const existing=db.prepare(`SELECT COUNT(*) AS count FROM bookings WHERE status='confirmed' AND starts_at < ? AND ends_at > ?`)
    .get(localIso(endDate,'23:59'),localIso(startDate,'00:00')).count;
  if(existing)throw new Error('In diesem Zeitraum bestehen bereits Termine. Bitte diese zuerst verschieben oder stornieren.');
  const insert=db.prepare(`INSERT INTO blocked_periods(starts_at,ends_at,reason) VALUES(?,?,?)`);
  let current = startDate;
  let lastId = null;
  let count = 0;
  while (current <= endDate) {
    const result = insert.run(localIso(current,'00:00'),localIso(current,'23:59'),reason.trim()||'Frei');
    lastId = Number(result.lastInsertRowid);
    count += 1;
    current = addDays(current, 1);
  }
  return {id:lastId,fromDate:startDate,toDate:endDate,count,reason:reason.trim()||'Frei'};
}

export function deleteBlockedPeriod(db,id) {
  db.prepare('DELETE FROM blocked_periods WHERE id=?').run(id);
}

export function createManualBooking(db,{serviceId,date,time,customer},now=new Date()) {
  for(const field of ['firstName','lastName'])if(!customer?.[field]?.trim())throw new Error('Vor- und Nachname sind erforderlich.');
  cleanupExpiredPendingBookings(db,now);
  db.exec('BEGIN IMMEDIATE');
  try{
    const { startsAt, endsAt } = ensureNoAdminConflict(db, { serviceId, date, time });
    const holdId=randomUUID();const bookingId=randomUUID();const createdAt=now.toISOString();
    db.prepare(`INSERT INTO holds(id,service_id,starts_at,ends_at,expires_at,created_at,status) VALUES(?,?,?,?,?,?,'converted')`)
      .run(holdId,serviceId,startsAt,endsAt,createdAt,createdAt);
    db.prepare(`INSERT INTO bookings(id,hold_id,service_id,starts_at,ends_at,first_name,last_name,email,phone,note,status,deposit_cents,payment_status,confirmation_status,payment_reference,terms_version,terms_accepted_at,confirmed_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'confirmed',0,'manual','confirmed','MANUAL',?,?,?,?)`).run(
      bookingId,holdId,serviceId,startsAt,endsAt,
      customer.firstName.trim(),customer.lastName.trim(),customer.email?.trim()||'',customer.phone?.trim()||'',customer.note?.trim()||null,
      'manual-admin',createdAt,createdAt,createdAt);
    ensureCustomerProfile(db, customer, now);
    db.exec('COMMIT');return {id:bookingId};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function cancelBooking(db,id) {
  cleanupExpiredPendingBookings(db);
  const booking = db.prepare(`
    SELECT b.id, b.email, b.starts_at AS startsAt, b.first_name AS firstName, b.last_name AS lastName,
      s.id AS serviceId, s.name AS serviceName
    FROM bookings b
    JOIN services s ON s.id=b.service_id
    WHERE b.id=? AND b.status='confirmed'
  `).get(id);
  if(!booking)throw new Error('Termin wurde nicht gefunden.');
  db.prepare(`UPDATE bookings SET status='cancelled' WHERE id=? AND status='confirmed'`).run(id);
  adminNotification(
    db,
    id,
    'booking_cancelled',
    'Termin storniert',
    `${booking.firstName} ${booking.lastName} wurde manuell storniert.`,
    new Date().toISOString(),
    { appointmentStartsAt: booking.startsAt, serviceName: booking.serviceName },
  );
  if (booking.email?.trim()) {
    queueCustomerMessage(db, {
      bookingId: id,
      kind: 'cancellation_confirmation',
      channel: 'email',
      recipient: booking.email.trim(),
      subject: 'Dein Termin wurde storniert',
      body: `${booking.firstName} ${booking.lastName}, dein Termin für ${booking.serviceName} am ${booking.startsAt.slice(0, 10)} um ${booking.startsAt.slice(11, 16)} Uhr wurde storniert.`,
      sendAfter: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
  }
  const waitlistCount = matchingWaitlistCount(db, booking);
  if (waitlistCount > 0) {
    adminNotification(
      db,
      null,
      'waitlist_match',
      'Warteliste passt',
      `${waitlistCount} Wartelisten-Einträge passen zu ${booking.serviceName} am ${booking.startsAt.slice(0, 10)}.`,
      new Date().toISOString(),
      { appointmentStartsAt: booking.startsAt, serviceName: booking.serviceName },
    );
  }
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
    body: `${booking.firstName} ${booking.lastName}, danke! Deine Anzahlung ist eingegangen. Dein Termin am ${booking.startsAt.slice(0, 10)} um ${booking.startsAt.slice(11, 16)} Uhr ist jetzt final bestätigt. Adresse: Wandsbeker Marktstraße 159, 22041 Hamburg.`,
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
    const { startsAt, endsAt } = ensureNoAdminConflict(db, { serviceId: booking.serviceId, date, time, ignoreBookingId: id });
    db.prepare(`UPDATE bookings SET starts_at=?,ends_at=?,status='confirmed' WHERE id=?`)
      .run(startsAt, endsAt, id);
    db.exec('COMMIT');return {id,startsAt:localIso(date,time)};
  }catch(error){db.exec('ROLLBACK');throw error;}
}

export function createWaitlistEntry(db, payload, now = new Date()) {
  const firstName = payload?.firstName?.trim();
  const lastName = payload?.lastName?.trim();
  const email = normalizeEmail(payload?.email);
  const phone = normalizePhone(payload?.phone);
  const serviceId = payload?.serviceId?.trim();
  const preferredDate = payload?.preferredDate?.trim() || null;
  const timeWindow = WAITLIST_TIME_WINDOWS.has(payload?.timeWindow) ? payload.timeWindow : 'egal';
  const note = payload?.note?.trim() || null;
  if (!serviceId) throw new Error('Bitte zuerst einen Service auswählen.');
  if (!firstName || !lastName || !email || !phone) throw new Error('Bitte fülle Vorname, Nachname, E-Mail und Telefon aus.');
  if (preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) throw new Error('Bitte wähle ein gültiges Wunschdatum.');
  const service = db.prepare('SELECT name, short_name AS shortName FROM services WHERE id=? AND active=1').get(serviceId);
  if (!service) throw new Error('Unbekannter Service.');
  const timestamp = now.toISOString();
  const existing = db.prepare(`
    SELECT id
    FROM waitlist_entries
    WHERE status='active'
      AND service_id=?
      AND lower(email)=?
      AND phone=?
      AND coalesce(preferred_date,'')=coalesce(?, '')
      AND time_window=?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(serviceId, email, phone, preferredDate, timeWindow);
  if (existing) throw new Error('Du stehst für diesen Wunsch bereits auf der Warteliste.');
  const id = randomUUID();
  db.prepare(`
    INSERT INTO waitlist_entries(
      id, service_id, preferred_date, time_window, first_name, last_name, email, phone, note, status, created_at, updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)
  `).run(id, serviceId, preferredDate, timeWindow, firstName, lastName, email, phone, note, timestamp, timestamp);
  ensureCustomerProfile(db, { firstName, lastName, email, phone }, now);
  adminNotification(
    db,
    null,
    'waitlist_created',
    'Neue Warteliste',
    `${firstName} ${lastName} möchte für ${service.name} informiert werden.`,
    timestamp,
    { serviceName: service.name },
  );
  return { id, serviceName: service.name, serviceShort: service.shortName };
}

export function listWaitlistEntries(db) {
  return db.prepare(`
    SELECT w.id, w.service_id AS serviceId, s.name AS serviceName, s.short_name AS serviceShort,
      w.preferred_date AS preferredDate, w.time_window AS timeWindow, w.first_name AS firstName,
      w.last_name AS lastName, w.email, w.phone, w.note, w.status, w.notified_at AS notifiedAt,
      w.created_at AS createdAt, w.updated_at AS updatedAt
    FROM waitlist_entries w
    JOIN services s ON s.id = w.service_id
    ORDER BY CASE w.status
      WHEN 'active' THEN 0
      WHEN 'notified' THEN 1
      WHEN 'booked' THEN 2
      ELSE 3
    END, w.created_at DESC
  `).all();
}

export function updateWaitlistEntry(db, id, { status }, now = new Date()) {
  const nextStatus = ['active', 'notified', 'booked', 'archived'].includes(status) ? status : null;
  if (!nextStatus) throw new Error('Ungültiger Wartelisten-Status.');
  const existing = db.prepare('SELECT id FROM waitlist_entries WHERE id=?').get(id);
  if (!existing) throw new Error('Wartelisten-Eintrag wurde nicht gefunden.');
  db.prepare(`
    UPDATE waitlist_entries
    SET status=?, notified_at=?, updated_at=?
    WHERE id=?
  `).run(nextStatus, nextStatus === 'notified' ? now.toISOString() : null, now.toISOString(), id);
  return { id, status: nextStatus };
}

export function getCustomerProfileContext(db, bookingId, now = new Date()) {
  const booking = db.prepare(`
    SELECT id, first_name AS firstName, last_name AS lastName, email, phone
    FROM bookings
    WHERE id=?
  `).get(bookingId);
  if (!booking) throw new Error('Termin wurde nicht gefunden.');
  const profile = ensureCustomerProfile(db, booking, now);
  const history = db.prepare(`
    SELECT b.id, b.starts_at AS startsAt, b.status, b.payment_status AS paymentStatus,
      s.name AS serviceName, s.short_name AS serviceShort
    FROM bookings b
    JOIN services s ON s.id = b.service_id
    WHERE (lower(b.email)=? AND ? <> '') OR (b.phone=? AND ? <> '')
    ORDER BY b.starts_at DESC
    LIMIT 12
  `).all(normalizeEmail(profile.email), normalizeEmail(profile.email), normalizePhone(profile.phone), normalizePhone(profile.phone));
  const waitlistEntries = db.prepare(`
    SELECT id, service_id AS serviceId, preferred_date AS preferredDate, time_window AS timeWindow,
      status, created_at AS createdAt
    FROM waitlist_entries
    WHERE (lower(email)=? AND ? <> '') OR (phone=? AND ? <> '')
    ORDER BY created_at DESC
    LIMIT 12
  `).all(normalizeEmail(profile.email), normalizeEmail(profile.email), normalizePhone(profile.phone), normalizePhone(profile.phone));
  return {
    profile,
    history,
    waitlistEntries,
    stats: {
      totalBookings: history.filter((item) => item.status === 'confirmed').length,
      cancellations: history.filter((item) => item.status === 'cancelled').length,
    },
  };
}

export function saveCustomerProfile(db, bookingId, { adminNote = '', preferences = '' }, now = new Date()) {
  const context = getCustomerProfileContext(db, bookingId, now);
  db.prepare(`
    UPDATE customer_profiles
    SET admin_note=?, preferences=?, updated_at=?
    WHERE id=?
  `).run(adminNote.trim(), preferences.trim(), now.toISOString(), context.profile.id);
  return {
    ...context.profile,
    adminNote: adminNote.trim(),
    preferences: preferences.trim(),
    updatedAt: now.toISOString(),
  };
}

export function listNotifications(db) {
  cleanupExpiredPendingBookings(db);
  touchSchedulers(db);
  return db.prepare(`SELECT id,booking_id AS bookingId,type,title,message,appointment_starts_at AS appointmentStartsAt,service_name AS serviceName,read_at AS readAt,created_at AS createdAt
    FROM notifications ORDER BY created_at DESC LIMIT 30`).all();
}

export function markNotificationsRead(db) {
  db.prepare(`UPDATE notifications SET read_at=? WHERE read_at IS NULL`).run(new Date().toISOString());
}
