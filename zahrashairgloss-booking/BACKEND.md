# Zahrashairgloss Backend

## Current foundation

- SQLite stores services, working hours, blocked periods, temporary holds, bookings, customer contact data, deposit status, and accepted terms version.
- Availability is calculated in 30-minute increments and rejects overlaps with confirmed bookings, active holds, and blocked periods.
- Holds are created inside an immediate SQLite transaction and expire after 10 minutes.
- A booking is only created from a valid, unexpired hold.
- The current payment route is explicitly a demo. It stores a 30.00 EUR demo deposit and must be replaced by PayPal Checkout plus verified webhooks before production.
- All admin API routes require a valid server-side session. The password is stored only as a scrypt hash in `.env`; sessions use HttpOnly, SameSite=Strict cookies and expire after 12 hours.

## Admin password

Generate a replacement hash without storing the plain password in source control:

```bash
npm run hash-password -- "a-long-new-password"
```

Copy the generated hash into `.env` as `ADMIN_PASSWORD_HASH`, then restart the server. The current local development PIN is intentionally short for convenience and must be replaced with a long unique password before public deployment.

Opening the source `index.html` directly redirects to `http://127.0.0.1:5173/`. The frontend requires the running server because availability, login, bookings, and admin data come from the API.

## Commands

```bash
npm run dev
npm test
npm run build
npm start
```

`npm run dev` starts Vite on port 5173 and the API on port 8787. `npm start` serves the built frontend and API together from port 8787.

## API

- `GET /api/config`
- `GET /api/services`
- `GET /api/dates`
- `GET /api/availability?serviceId=cut&date=2026-06-11`
- `POST /api/holds`
- `DELETE /api/holds/:id`
- `POST /api/bookings/confirm-demo-payment`
- `GET /api/admin/bookings?date=2026-06-11`

## Confirmed booking windows

- Balayage Monday-Friday: 10:00-14:00 or 14:00-18:00.
- Balayage Saturday: 09:30-13:30 or 13:30-17:00. The second Saturday window is intentionally 3.5 hours.
- Cutting, Glossing, Glossing & Cut, and Colouring Monday-Friday: 11:30 or 15:30.
- Cutting, Glossing, Glossing & Cut, and Colouring Saturday: 10:45 or 14:45.
- Glossing & Cut is currently configured as 60 minutes.
- Sunday is closed.
- No holidays or vacation periods are configured yet.
- All stored timestamps currently use the summer Berlin offset. Replace this with a timezone-aware production implementation before launch.
