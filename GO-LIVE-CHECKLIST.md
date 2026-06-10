# Zahrashairgloss: Go-live-Checkliste

## 1. Geschäftliche Entscheidungen

- [ ] Endgültige Preise aller Services und Behandlung des Restbetrags festlegen.
- [ ] Öffnungszeiten, Pausen, Urlaub, Feiertage und Vorlaufzeit für Buchungen definieren.
- [ ] Regeln für Verspätungen, Nichterscheinen, Krankheit und Kulanz festlegen.
- [ ] Festlegen, ob eine Umbuchung nur einmal oder mehrfach erlaubt ist.
- [ ] Salonadresse, Geschäfts-E-Mail und geschäftliche Telefonnummer bestätigen.

## 2. Rechtliches

- [ ] Regelung zur 30-Euro-Anzahlung von einer auf deutsches Verbraucherrecht spezialisierten Kanzlei prüfen lassen.
- [ ] Vollständiges Impressum einbauen.
- [ ] Datenschutzerklärung für Buchung, Hosting, E-Mail, PayPal und Protokolldaten erstellen.
- [ ] Buchungsbedingungen/AGB mit Stornierung, Umbuchung, Verspätung und Nichterscheinen erstellen.
- [ ] Widerrufsbelehrung und mögliche Ausnahmen für termingebundene Dienstleistungen rechtlich prüfen.
- [ ] Einwilligungs- und Versionsnachweis der akzeptierten Bedingungen speichern.
- [ ] Auftragsverarbeitungsverträge mit Hosting-, E-Mail- und Kalenderanbietern abschließen, soweit erforderlich.
- [ ] Prüfen, ob ein Cookie-Banner nötig ist; unnötiges Tracking vermeiden.

## 3. Buchungslogik

- [x] Datenbank für Services, Dauern, Kundinnen, Termine und Zahlungen anbinden.
- [x] Verfügbarkeiten aus hinterlegten Arbeitszeiten und bestehenden Terminen berechnen. Reale Arbeitszeiten/Pausen noch bestätigen.
- [x] Serverseitige 10-Minuten-Sperre implementieren, damit ein Termin nicht doppelt gebucht wird.
- [x] Abgelaufene Reservierungen automatisch freigeben.
- [ ] Umbuchungslink mit 24-Stunden-Prüfung umsetzen.
- [ ] Stornierungsworkflow und Statushistorie implementieren.
- [ ] Zeitzonen, Sommerzeit und Datumswechsel testen.
- [ ] Schutz vor Spam und automatisierten Massenreservierungen einbauen.

## 4. PayPal und Zahlungen

- [ ] PayPal-Geschäftskonto einrichten und verifizieren.
- [ ] PayPal Checkout serverseitig integrieren; Betrag immer serverseitig auf 30,00 Euro setzen.
- [ ] Webhooks für erfolgreiche, fehlgeschlagene, stornierte und zurückerstattete Zahlungen verarbeiten.
- [ ] Buchung erst nach verifiziertem PayPal-Webhook bestätigen.
- [ ] Doppelte Webhooks und wiederholte Zahlungen sicher abfangen.
- [ ] Rückerstattungsprozess für Absagen durch Zahrashairgloss implementieren.
- [ ] Zahlungs-ID, Betrag, Status und Zeitstempel revisionssicher speichern.
- [ ] Steuerliche Behandlung, Belege und spätere Verrechnung der Anzahlung klären.

## 5. Benachrichtigungen und Kalender

- [ ] Buchungsbestätigung an Kundin und Zahra versenden.
- [ ] Erinnerung 24 oder 48 Stunden vor dem Termin versenden.
- [ ] E-Mails für Umbuchung, Stornierung, Zahlung und Rückerstattung erstellen.
- [ ] Kalender-Synchronisation mit Google Calendar, Apple Calendar oder gewünschtem System umsetzen.
- [ ] Admin-Benachrichtigungen für neue und geänderte Termine einbauen.
- [ ] Zustellbarkeit mit eigener Domain, SPF, DKIM und DMARC konfigurieren.

## 6. Admin-Bereich

- [x] Passwortgeschützten Admin-Login mit serverseitiger Sitzung implementieren. Zwei-Faktor-Authentifizierung bleibt vor dem öffentlichen Livegang empfohlen.
- [x] Kompakte Tages- und Wochenansicht fertigstellen. Monatsansicht ist bewusst noch nicht umgesetzt.
- [x] Termine manuell erstellen, verschieben und stornieren können.
- [x] Ganze freie Tage und Abwesenheiten verwalten können. Arbeitszeiten und Services sind noch nicht editierbar.
- [ ] Kundendaten minimieren und Lösch-/Exportfunktionen anbieten.
- [x] Zahlungsquelle und Buchungsdetails im Tageskalender nachvollziehbar anzeigen.
- [ ] Rollen und Zugriffsrechte vorbereiten, falls später Mitarbeitende dazukommen.

## 7. Qualität und Veröffentlichung

- [ ] Domain auswählen und DNS konfigurieren.
- [ ] Datenschutzfreundliches Hosting in der EU auswählen.
- [ ] Backup-, Wiederherstellungs- und Monitoring-Konzept einrichten.
- [ ] Mobile Geräte, Safari, Chrome, Firefox und langsame Verbindungen testen.
- [ ] Barrierefreiheit prüfen: Tastatur, Fokus, Kontrast, Fehlermeldungen und Screenreader.
- [ ] End-to-End-Tests für Buchung, Zeitablauf, Doppelbuchung, Zahlung und Umbuchung erstellen.
- [ ] Testzahlung und Rückerstattung im PayPal-Sandbox-Modus vollständig durchführen.
- [ ] Fehlerseiten und verständliche Wiederholungswege für abgebrochene Zahlungen ergänzen.
- [ ] Sicherheitsprüfung, Updates und Schutz sensibler Daten durchführen.
- [ ] Vor dem Livegang eine vollständige Probebuchung mit Zahra durchführen.
