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

  const authHeader = request.headers.get("Authorization") || "";
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: isAdmin, error: adminError } = await userClient.rpc("is_admin");
  if (adminError || !isAdmin) return json(401, { message: "Nicht autorisiert." });

  let bookingId = "";
  try {
    const payload = await request.json();
    bookingId = String(payload?.bookingId || "").trim();
  } catch {
    return json(400, { message: "Ungültige Anfrage." });
  }

  if (!bookingId) return json(400, { message: "bookingId fehlt." });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  const { data: booking, error: bookingError } = await adminClient
    .from("bookings")
    .select("id, first_name, last_name, email, starts_at, service_id, payment_status, confirmation_status")
    .eq("id", bookingId)
    .single();

  if (bookingError || !booking) return json(404, { message: "Buchung wurde nicht gefunden." });
  if (booking.payment_status !== "paid" || booking.confirmation_status !== "confirmed") {
    return json(409, { message: "Die Buchung ist noch nicht final bestätigt." });
  }

  const { data: service } = await adminClient
    .from("services")
    .select("name")
    .eq("id", booking.service_id)
    .single();

  const appointmentLabel = formatAppointment(booking.starts_at);
  const serviceName = service?.name || "dein Termin";
  const text =
    `${booking.first_name} ${booking.last_name}, danke! ` +
    `Deine Anzahlung ist eingegangen. Dein Termin für ${serviceName} am ${appointmentLabel} Uhr ist jetzt final bestätigt.`;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom,
      to: booking.email,
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
