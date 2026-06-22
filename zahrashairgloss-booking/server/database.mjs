import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SERVICES = [
  ['balayage', 'Balayage inkl. Pflege, Schnitt und Styling', 'Balayage Komplett', 240],
  ['consultation', 'Probe/Beratung', 'Probe/Beratung', 30],
  ['cut', 'Schneiden', 'Schneiden', 60],
  ['gloss', 'Glossing', 'Glossing', 60],
  ['gloss-cut', 'Glossing & Schnitt', 'Glossing & Schnitt', 60],
  ['colour', 'Colouring', 'Colouring', 60],
];

const WORKING_HOURS = [
  [1, '10:00', '18:00'], [2, '10:00', '18:00'], [3, '10:00', '18:00'],
  [4, '10:00', '18:00'], [5, '10:00', '18:00'], [6, '09:30', '17:00'],
];

export function createDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0), active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS working_hours (
      weekday INTEGER PRIMARY KEY CHECK (weekday BETWEEN 1 AND 7),
      opens_at TEXT NOT NULL, closes_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS blocked_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, reason TEXT
    );
    CREATE TABLE IF NOT EXISTS holds (
      id TEXT PRIMARY KEY, service_id TEXT NOT NULL REFERENCES services(id),
      starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','converted','expired'))
    );
    CREATE INDEX IF NOT EXISTS holds_time_idx ON holds(starts_at, ends_at, status, expires_at);
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY, hold_id TEXT UNIQUE NOT NULL REFERENCES holds(id),
      service_id TEXT NOT NULL REFERENCES services(id), starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
      first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, note TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed', deposit_cents INTEGER NOT NULL DEFAULT 3000,
      payment_status TEXT NOT NULL, confirmation_status TEXT NOT NULL DEFAULT 'awaiting_payment',
      payment_reference TEXT, terms_version TEXT NOT NULL,
      terms_accepted_at TEXT NOT NULL, confirmed_at TEXT, reminder_queued_at TEXT,
      reminder_channel TEXT NOT NULL DEFAULT 'email', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bookings_time_idx ON bookings(starts_at, ends_at, status);
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      booking_id TEXT REFERENCES bookings(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      appointment_starts_at TEXT,
      service_name TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(read_at, created_at);
    CREATE TABLE IF NOT EXISTS customer_messages (
      id TEXT PRIMARY KEY,
      booking_id TEXT REFERENCES bookings(id),
      kind TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      send_after TEXT NOT NULL,
      sent_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_messages_pending_idx ON customer_messages(sent_at, send_after, attempts);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS customer_profiles (
      id TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      admin_note TEXT NOT NULL DEFAULT '',
      preferences TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS waitlist_entries (
      id TEXT PRIMARY KEY,
      service_id TEXT NOT NULL REFERENCES services(id),
      preferred_date TEXT,
      time_window TEXT NOT NULL DEFAULT 'egal' CHECK (time_window IN ('egal','vormittag','nachmittag')),
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','notified','booked','archived')),
      notified_at TEXT,
      matched_booking_id TEXT REFERENCES bookings(id),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS customer_profiles_updated_idx ON customer_profiles(updated_at);
    CREATE INDEX IF NOT EXISTS waitlist_entries_status_idx ON waitlist_entries(status, service_id, preferred_date, created_at);
  `);
  const tableColumns = (table) => new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  const addColumn = (table, definition) => {
    const columnName = definition.trim().split(/\s+/)[0];
    if (!tableColumns(table).has(columnName)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  };
  addColumn('bookings', "confirmation_status TEXT NOT NULL DEFAULT 'awaiting_payment'");
  addColumn('bookings', 'confirmed_at TEXT');
  addColumn('bookings', 'reminder_queued_at TEXT');
  addColumn('bookings', "reminder_channel TEXT NOT NULL DEFAULT 'email'");
  addColumn('notifications', 'appointment_starts_at TEXT');
  addColumn('notifications', 'service_name TEXT');
  addColumn('customer_messages', 'attempts INTEGER NOT NULL DEFAULT 0');
  addColumn('customer_messages', 'last_error TEXT');
  addColumn('customer_profiles', "admin_note TEXT NOT NULL DEFAULT ''");
  addColumn('customer_profiles', "preferences TEXT NOT NULL DEFAULT ''");
  addColumn('waitlist_entries', "time_window TEXT NOT NULL DEFAULT 'egal'");
  addColumn('waitlist_entries', "status TEXT NOT NULL DEFAULT 'active'");
  addColumn('waitlist_entries', 'notified_at TEXT');
  addColumn('waitlist_entries', 'matched_booking_id TEXT REFERENCES bookings(id)');
  addColumn('waitlist_entries', 'updated_at TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS customer_profiles_email_uidx
    ON customer_profiles(lower(email))
    WHERE email IS NOT NULL AND trim(email) <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS customer_profiles_phone_uidx
    ON customer_profiles(phone)
    WHERE phone IS NOT NULL AND trim(phone) <> '';
  `);

  const insertService = db.prepare(`
    INSERT INTO services (id, name, short_name, duration_minutes) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, short_name=excluded.short_name,
      duration_minutes=excluded.duration_minutes
  `);
  for (const service of SERVICES) insertService.run(...service);
  const insertHours = db.prepare(`
    INSERT INTO working_hours (weekday, opens_at, closes_at) VALUES (?, ?, ?)
    ON CONFLICT(weekday) DO UPDATE SET opens_at=excluded.opens_at, closes_at=excluded.closes_at, active=1
  `);
  for (const hours of WORKING_HOURS) insertHours.run(...hours);
  return db;
}

export function cleanupExpiredHolds(db, now = new Date()) {
  db.prepare(`UPDATE holds SET status='expired' WHERE status='active' AND expires_at <= ?`).run(now.toISOString());
}

export function cleanupExpiredPendingBookings(db, now = new Date()) {
  // Unpaid bookings now stay visible until an admin reviews or changes them manually.
  return db;
}
