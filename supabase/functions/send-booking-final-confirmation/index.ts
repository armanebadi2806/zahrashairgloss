import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const formatAppointment = (startsAt: string) =>
  new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startsAt));

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const mailFrom = Deno.env.get("MAIL_FROM") || "Zahrashairgloss <hello@zahrashairgloss.de>";

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey || !resendApiKey) {
    return json(500, { message: "Mailversand ist noch nicht vollständig konfiguriert." });
  }

  let bookingId = "";
  let bookingPayload: Record<string, unknown> | null = null;
  try {
    const payload = await request.json();
    bookingId = String(payload?.bookingId || "").trim();
    bookingPayload = typeof payload?.booking === "object" && payload.booking ? payload.booking as Record<string, unknown> : null;
  } catch {
    return json(400, { message: "Ungültige Anfrage." });
  }

  if (!bookingId) return json(400, { message: "bookingId fehlt." });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const booking = bookingPayload || (await adminClient
    .from("bookings")
    .select("id, first_name, last_name, email, starts_at, service_id, payment_status, confirmation_status")
    .eq("id", bookingId)
    .single()).data;

  if (!booking) return json(404, { message: "Buchung wurde nicht gefunden." });

  const paymentStatus = String(booking.payment_status || booking.paymentStatus || "").toLowerCase();
  const confirmationStatus = String(booking.confirmation_status || booking.confirmationStatus || "").toLowerCase();
  if (paymentStatus !== "paid" || confirmationStatus !== "confirmed") {
    return json(409, { message: "Die Buchung ist noch nicht final bestätigt." });
  }

  const serviceName = String(booking.serviceName || booking.service_name || "");
  const firstName = String(booking.firstName || booking.first_name || "");
  const lastName = String(booking.lastName || booking.last_name || "");
  const email = String(booking.email || "");
  const startsAt = String(booking.startsAt || booking.starts_at || "");
  const serviceId = String(booking.serviceId || booking.service_id || "");
  const { data: service } = serviceName || !serviceId ? { data: null } : await adminClient
    .from("services")
    .select("name")
    .eq("id", serviceId)
    .single();

  const appointmentLabel = formatAppointment(startsAt);
  const resolvedServiceName = serviceName || service?.name || "dein Termin";
  const text =
    `${firstName} ${lastName}, danke! ` +
    `Deine Anzahlung ist eingegangen. Dein Termin für ${resolvedServiceName} am ${appointmentLabel} Uhr ist jetzt final bestätigt. ` +
    `Adresse: Wandsbeker Marktstraße 159, 22041 Hamburg.`;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom,
      to: email,
      subject: "Dein Termin ist jetzt bestätigt",
      text,
    }),
  });

  const resendPayload = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    return json(502, {
      message: resendPayload?.message || resendPayload?.error || "Resend hat die Mail abgelehnt.",
    });
  }

  return json(200, { sent: true, id: resendPayload?.id || null });
});
