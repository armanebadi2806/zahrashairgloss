# Prototype Instructions

Run the local server yourself and open the preview in the in-app browser. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Confirmed product direction

- The public product is a booking flow only, comparable to Calendly but more refined and modern.
- Do not add salon marketing sections, team pages, navigation, long promotional copy, or public service prices.
- Keep Pearl Editorial styling: minimal black/white surfaces, editorial serif type, restrained cool-lilac accents, and generous whitespace.
- Zahra's portrait appears as a small circular trust element next to her name.
- Booking requires a 30.00 EUR PayPal deposit and explicit acceptance of the deposit/transfer terms.
- A selected appointment must be held server-side for 10 minutes and protected against double booking.
- Fixed availability: Balayage Mon-Fri at 10:00/14:00; Sat at 09:30/13:30. Other services Mon-Fri at 11:30/15:30; Sat at 10:45/14:45.
- Glossing & Cut is currently treated as 60 minutes. The Saturday 13:30 Balayage window intentionally ends at 17:00.
- The admin area is mobile-first. Prioritize one-handed use, large touch targets, compact week/day navigation, and bottom sheets over desktop-heavy dashboards.
- Admin supports manual bookings, full free days, cancellation, appointment details, and unread online-booking notifications.
- Every admin API is protected by a server-side session. Never expose or hardcode the plaintext admin password; only commit `.env.example`, never `.env`.
