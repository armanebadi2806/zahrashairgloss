import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bell, CalendarBlank, CaretLeft, CaretRight, Check, Clock, Plus, Scissors, Sparkle, Trash, User, X } from '@phosphor-icons/react';

const USE_SUPABASE = !['localhost', '127.0.0.1'].includes(window.location.hostname);
const SUPABASE_URL = 'https://kpncmfikfggnnlprieti.supabase.co';
const SUPABASE_KEY = 'sb_publishable_UUac6eNn00yh7ZM5UsLZGw_U2BjRP4c';
const ADMIN_EMAIL = 'dxpvtm8nx9@privaterelay.appleid.com';
const PAYPAL_EMAIL = 'zahrashairgloas@gmail.com';
const asset = (path) => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
const SERVICE_COLOR_PALETTE = ['#b8acc7', '#8e9b92', '#d88952', '#d46d88', '#6d8db3', '#9d7a5c', '#7e6aa8', '#4f8a7b'];
const DEFAULT_SERVICE_COLORS = {
  balayage: '#8e9b92',
  cut: '#b8acc7',
  gloss: '#d88952',
  'gloss-cut': '#d46d88',
  colour: '#6d8db3',
};

const sessionToken = () => window.localStorage.getItem('zahra_admin_token') || '';
const seenBookingAlertsKey = 'zahra_seen_booking_alerts';
const readSeenBookingAlerts = () => {
  try { return new Set(JSON.parse(window.localStorage.getItem(seenBookingAlertsKey) || '[]')); }
  catch { return new Set(); }
};
const rememberBookingAlert = (ids) => window.localStorage.setItem(seenBookingAlertsKey, JSON.stringify([...ids].slice(-100)));
const serviceColorsKey = 'zahra_service_colors';
const readServiceColors = () => {
  try { return { ...DEFAULT_SERVICE_COLORS, ...JSON.parse(window.localStorage.getItem(serviceColorsKey) || '{}') }; }
  catch { return { ...DEFAULT_SERVICE_COLORS }; }
};
const writeServiceColors = (colors) => window.localStorage.setItem(serviceColorsKey, JSON.stringify(colors));
const isMissingFunctionError = (error) => /Could not find the function public\.admin_mark_booking_paid|schema cache/i.test(error?.message || '');
const isBlockedUpdateError = (error) => /permission denied for table bookings/i.test(error?.message || '');
const isMissingBlockRangeFunctionError = (error) => /public\.admin_create_blocks|schema cache|operator does not exist: timestamp with time zone \+ integer/i.test(error?.message || '');
const supabaseRequest = async (pathname, { method='GET', body, token='', headers: extraHeaders = {} }={}) => {
  const response = await fetch(`${SUPABASE_URL}${pathname}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token || SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(data?.message || data?.error_description || data?.hint || 'Die Anfrage ist fehlgeschlagen.');
  return data;
};
const rpc = (name, params={}, token) => supabaseRequest(`/rest/v1/rpc/${name}`, {method:'POST',body:params,token});
const adminRpc = (name, params={}) => rpc(name, params, sessionToken());
const invokeEdgeFunction = async (name, { method='POST', body, token=sessionToken() }={}) => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token || SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); }
    catch { data = { message: text }; }
  }
  if (!response.ok) throw new Error(data?.message || 'Die Anfrage ist fehlgeschlagen.');
  return data;
};
const berlinIso = (value) => {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).filter((part)=>part.type!=='literal').map((part)=>[part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const readField = (item, snakeKey, camelKey = snakeKey.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())) => item?.[snakeKey] ?? item?.[camelKey];
const normalizeBooking = (item) => {
  const paymentValue = readField(item, 'payment_status', 'paymentStatus');
  const confirmationValue = readField(item, 'confirmation_status', 'confirmationStatus');
  const paymentStatus = paymentValue;
  const confirmationStatus = confirmationValue === 'confirmed'
    ? confirmationValue
    : (confirmationValue || (paymentStatus==='paid'||paymentStatus==='manual'?'confirmed':'awaiting_payment'));
  return {
    ...item,
    serviceId: readField(item, 'service_id', 'serviceId'),
    serviceName: readField(item, 'service_name', 'serviceName'),
    serviceShort: readField(item, 'service_short', 'serviceShort'),
    startsAt: berlinIso(readField(item, 'starts_at', 'startsAt')),
    endsAt: berlinIso(readField(item, 'ends_at', 'endsAt')),
    firstName: readField(item, 'first_name', 'firstName'),
    lastName: readField(item, 'last_name', 'lastName'),
    paymentStatus,
    confirmationStatus,
    confirmedAt: readField(item, 'confirmed_at', 'confirmedAt'),
    reminderQueuedAt: readField(item, 'reminder_queued_at', 'reminderQueuedAt'),
    reminderChannel: readField(item, 'reminder_channel', 'reminderChannel'),
    depositCents: readField(item, 'deposit_cents', 'depositCents'),
  };
};
const hasOpenDeposit = (booking) => booking.confirmationStatus !== 'confirmed' && booking.paymentStatus !== 'paid' && booking.paymentStatus !== 'manual';
const normalizeBlock = (item) => ({...item,startsAt:berlinIso(readField(item, 'starts_at', 'startsAt')),endsAt:berlinIso(readField(item, 'ends_at', 'endsAt'))});
const normalizeNotification = (item) => {
  const appointmentStartsAt = readField(item, 'appointment_starts_at', 'appointmentStartsAt');
  return {
    ...item,
    bookingId: readField(item, 'booking_id', 'bookingId'),
    readAt: readField(item, 'read_at', 'readAt'),
    createdAt: readField(item, 'created_at', 'createdAt'),
    appointmentStartsAt: appointmentStartsAt ? berlinIso(appointmentStartsAt) : null,
    serviceName: readField(item, 'service_name', 'serviceName'),
  };
};
const openPayPalSendMoney = () => window.open('https://www.paypal.com/us/digital-wallet/send-receive-money/send-money','_blank','noopener,noreferrer');
const normalizeDateValue = (value) => {
  if (typeof value !== 'string') return '';
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : value;
};
const setBookingPaidViaRest = async (id) => {
  const now = new Date().toISOString();
  await supabaseRequest(`/rest/v1/bookings?id=eq.${id}`, {
    method: 'PATCH',
    token: sessionToken(),
    headers: { Prefer: 'return=minimal' },
    body: { payment_status: 'paid', confirmation_status: 'confirmed', confirmed_at: now },
  });
};

const supabaseApi = async (path, options={}) => {
  const method=options.method||'GET';
  const payload=options.body?JSON.parse(options.body):{};
  if(path==='/api/config')return {depositCents:3000,holdMinutes:10,termsVersion:'2026-06-10',timezone:'Europe/Berlin'};
  if(path==='/api/services'){
    const rows=await supabaseRequest('/rest/v1/services?select=id,name,short_name,duration_minutes&active=eq.true&order=duration_minutes.desc');
    return {services:rows.map((row)=>({id:row.id,name:row.name,short:row.short_name,duration:row.duration_minutes}))};
  }
  if(path.startsWith('/api/dates')){const p=new URLSearchParams(path.split('?')[1]);const rows=await rpc('get_bookable_dates',{p_service_id:p.get('serviceId')});return {dates:rows.map((row)=>normalizeDateValue(row.date))};}
  if(path.startsWith('/api/availability')){const p=new URLSearchParams(path.split('?')[1]);const rows=await rpc('get_available_slots',{p_service_id:p.get('serviceId'),p_date:p.get('date')});return {slots:rows.map((row)=>row.slot_time)};}
  if(path==='/api/holds'&&method==='POST')return {hold:await rpc('create_hold',{p_service_id:payload.serviceId,p_date:payload.date,p_time:payload.time})};
  if(path.startsWith('/api/holds/')&&method==='DELETE'){await rpc('release_hold',{p_hold_id:path.split('/').pop()});return {released:true};}
  if(path==='/api/bookings/confirm-demo-payment'&&method==='POST'){
    const booking = await rpc('confirm_booking',{p_hold_id:payload.holdId,p_first_name:payload.customer.firstName,p_last_name:payload.customer.lastName,p_email:payload.customer.email,p_phone:payload.customer.phone,p_note:payload.customer.note||'',p_terms_version:payload.acceptedTermsVersion});
    try{
      await invokeEdgeFunction('send-booking-reservation-confirmation',{body:{bookingId:booking.id,booking:{...booking,serviceId:payload.serviceId,serviceName:payload.serviceName,serviceShort:payload.serviceShort,firstName:payload.customer.firstName,lastName:payload.customer.lastName,email:payload.customer.email,phone:payload.customer.phone,note:payload.customer.note||'',startsAt:booking.startsAt}}});
      return {booking,emailSent:true};
    }catch(error){
      return {booking,emailSent:false,emailError:error.message};
    }
  }
  if(path==='/api/admin/login'&&method==='POST'){
    const auth=await supabaseRequest('/auth/v1/token?grant_type=password',{method:'POST',body:{email:ADMIN_EMAIL,password:payload.password},token:SUPABASE_KEY});
    window.localStorage.setItem('zahra_admin_token',auth.access_token);return {authenticated:true};
  }
  if(path==='/api/admin/logout'&&method==='POST'){window.localStorage.removeItem('zahra_admin_token');return {authenticated:false};}
  if(path==='/api/admin/session'){
    if(!sessionToken())return {authenticated:false,configured:true};
    try{await supabaseRequest('/auth/v1/user',{token:sessionToken()});return {authenticated:true,configured:true};}catch{window.localStorage.removeItem('zahra_admin_token');return {authenticated:false,configured:true};}
  }
  if(path.startsWith('/api/admin/calendar')){const p=new URLSearchParams(path.split('?')[1]);const [bookings,blocks]=await Promise.all([adminRpc('admin_calendar',{p_from:p.get('from'),p_to:p.get('to')}),adminRpc('admin_blocks',{p_from:p.get('from'),p_to:p.get('to')})]);return {bookings:bookings.map(normalizeBooking),blocks:blocks.map(normalizeBlock)};}
  if(path==='/api/admin/notifications')return {notifications:(await adminRpc('admin_notifications')).map(normalizeNotification)};
  if(path==='/api/admin/notifications/read'&&method==='POST'){await adminRpc('admin_mark_notifications_read');return {read:true};}
  if(path==='/api/admin/blocks'&&method==='POST'){
    const fromDate = payload.fromDate || payload.date;
    const toDate = payload.toDate || payload.date || payload.fromDate;
    try{
      const count = await adminRpc('admin_create_blocks',{p_from_date:fromDate,p_to_date:toDate,p_reason:payload.reason});
      return {block:{count}};
    }catch(error){
      if (!isMissingBlockRangeFunctionError(error)) throw error;
      const dates = eachDateInRange(fromDate,toDate);
      await Promise.all(dates.map((value)=>adminRpc('admin_create_block',{p_date:value,p_reason:payload.reason})));
      return {block:{count:dates.length}};
    }
  }
  if(path.startsWith('/api/admin/blocks/')&&method==='DELETE'){await adminRpc('admin_delete_block',{p_id:Number(path.split('/').pop())});return {deleted:true};}
  if(path.startsWith('/api/admin/bookings/')&&path.endsWith('/payment')&&method==='POST'){
    const id=path.split('/')[4];
    try{
      await adminRpc('admin_mark_booking_paid',{p_id:id});
    }catch(error){
      if(!isMissingFunctionError(error) && !isBlockedUpdateError(error)) throw error;
      await setBookingPaidViaRest(id);
    }
    try{
      await invokeEdgeFunction('send-booking-final-confirmation',{body:{bookingId:id}});
      return {paid:true,emailSent:true};
    }catch(error){
      return {paid:true,emailSent:false,emailError:error.message};
    }
  }
  if(path.startsWith('/api/admin/bookings/')&&method==='DELETE'){await adminRpc('admin_cancel_booking',{p_id:path.split('/').pop()});return {cancelled:true};}
  if(path==='/api/admin/bookings'&&method==='POST')return {booking:await adminRpc('admin_create_booking',{p_service_id:payload.serviceId,p_date:payload.date,p_time:payload.time,p_first_name:payload.customer.firstName,p_last_name:payload.customer.lastName,p_email:payload.customer.email||'',p_phone:payload.customer.phone||'',p_note:payload.customer.note||''})};
  if(path.startsWith('/api/admin/bookings/')&&method==='PATCH')return {booking:await adminRpc('admin_move_booking',{p_id:path.split('/').pop(),p_date:payload.date,p_time:payload.time})};
  throw new Error('Diese Funktion ist noch nicht verfügbar.');
};

const api = async (path, options) => {
  if(USE_SUPABASE)return supabaseApi(path,options);
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Die Anfrage ist fehlgeschlagen.');
  return body;
};

function durationLabel(minutes) {
  if (minutes === 240) return '4 Stunden';
  if (minutes === 90) return '1 Stunde 30 Minuten';
  return '1 Stunde';
}

function dateView(value) {
  const normalizedValue = normalizeDateValue(value);
  const date = new Date(`${normalizedValue}T12:00:00`);
  return {
    value: normalizedValue,
    day: new Intl.DateTimeFormat('de-DE', { weekday: 'short' }).format(date).replace('.', ''),
    date: new Intl.DateTimeFormat('de-DE', { day: '2-digit' }).format(date),
    month: new Intl.DateTimeFormat('de-DE', { month: 'short' }).format(date).replace('.', ''),
    full: new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long' }).format(date),
  };
}

const isSunday = (value) => new Date(`${normalizeDateValue(value)}T12:00:00`).getDay() === 0;

function Summary({ service, date, slot, onEdit }) {
  return <aside className="booking-summary">
    <div className="brand-lockup"><img src={asset('/assets/zahra-portrait.jpg')} alt="Zahra von Zahrashairgloss" /><div><span>Bei Zahra</span><div className="brand">Zahrashairgloss</div></div></div>
    <div className="summary-title"><span>Online-Buchung</span><h1>Dein Termin.<br />Einfach gebucht.</h1></div>
    <div className="summary-details">
      <div><Scissors size={19}/><p><span>Service</span><strong>{service ? service.short : 'Noch nicht gewählt'}</strong>{service&&<small>{durationLabel(service.duration)}</small>}</p>{service&&<button onClick={()=>onEdit(1)}>Ändern</button>}</div>
      <div><CalendarBlank size={19}/><p><span>Termin</span><strong>{date&&slot?`${date.full}, ${slot} Uhr`:'Noch nicht gewählt'}</strong></p>{date&&slot&&<button onClick={()=>onEdit(2)}>Ändern</button>}</div>
    </div>
    <p className="summary-help">Fragen zur Buchung?<br/><a href="mailto:hallo@zahrashairgloss.de">hallo@zahrashairgloss.de</a></p>
  </aside>;
}

function StepHeader({ step, title, text }) {
  return <div className="step-header"><span>Schritt {step} von 4</span><h2>{title}</h2>{text&&<p>{text}</p>}</div>;
}

function BookingApp({ onAdmin }) {
  const [step,setStep]=useState(1);
  const [services,setServices]=useState([]);
  const [dates,setDates]=useState([]);
  const [service,setService]=useState(null);
  const [date,setDate]=useState(null);
  const [slot,setSlot]=useState(null);
  const [slots,setSlots]=useState([]);
  const [hold,setHold]=useState(null);
  const [seconds,setSeconds]=useState(600);
  const [payment,setPayment]=useState('idle');
  const [termsVersion,setTermsVersion]=useState('');
  const [depositTermsAccepted,setDepositTermsAccepted]=useState(false);
  const [paypalEmailCopied,setPaypalEmailCopied]=useState(false);
  const [reservationEmailWarning,setReservationEmailWarning]=useState('');
  const [customer,setCustomer]=useState({firstName:'',lastName:'',email:'',phone:'',note:''});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  useEffect(()=>{Promise.all([api('/api/services'),api('/api/config')]).then(([serviceData,config])=>{setServices(serviceData.services);setTermsVersion(config.termsVersion);}).catch((err)=>setError(err.message)).finally(()=>setLoading(false));},[]);
  useEffect(()=>{if(!service)return;setDates([]);setDate(null);setSlot(null);setLoading(true);api(`/api/dates?serviceId=${encodeURIComponent(service.id)}`).then((data)=>setDates(data.dates.map(dateView))).catch((err)=>setError(err.message)).finally(()=>setLoading(false));},[service]);
  useEffect(()=>{if(!date||!service)return;setSlots([]);setSlot(null);setLoading(true);api(`/api/availability?serviceId=${encodeURIComponent(service.id)}&date=${date.value}`).then((data)=>setSlots(data.slots)).catch((err)=>setError(err.message)).finally(()=>setLoading(false));},[date,service]);
  useEffect(()=>{if(!hold||payment==='success')return;const update=()=>{const left=Math.max(0,Math.ceil((new Date(hold.expiresAt).getTime()-Date.now())/1000));setSeconds(left);if(left===0){setError('Die Reservierungszeit ist abgelaufen. Bitte wähle den Termin erneut.');setHold(null);setStep(2);}};update();const timer=window.setInterval(update,1000);return()=>window.clearInterval(timer);},[hold,payment]);

  const releaseHold=async()=>{if(!hold)return;try{await api(`/api/holds/${hold.id}`,{method:'DELETE'});}catch{}setHold(null);};
  const editStep=async(target)=>{if(target<3)await releaseHold();setError('');setStep(target);};
  const chooseService=(item)=>{setService(item);setDate(null);setSlot(null);setError('');window.setTimeout(()=>setStep(2),140);};
  const reserveSlot=async()=>{setError('');setLoading(true);try{const data=await api('/api/holds',{method:'POST',body:JSON.stringify({serviceId:service.id,date:date.value,time:slot})});setHold(data.hold);setStep(3);}catch(err){setError(err.message);const data=await api(`/api/availability?serviceId=${service.id}&date=${date.value}`);setSlots(data.slots);setSlot(null);}finally{setLoading(false);}};
  const updateCustomer=(field)=>(event)=>setCustomer((current)=>({...current,[field]:event.target.value}));
  const contactValid=customer.firstName.trim()&&customer.lastName.trim()&&customer.email.includes('@')&&customer.phone.trim();
  const pay=async()=>{if(!depositTermsAccepted||!hold)return;setPayment('loading');setError('');setReservationEmailWarning('');try{const result=await api('/api/bookings/confirm-demo-payment',{method:'POST',body:JSON.stringify({holdId:hold.id,serviceId:service.id,serviceName:service.name,serviceShort:service.short,customer,acceptedTermsVersion:termsVersion})});if(result?.emailSent===false)setReservationEmailWarning('Die Reservierungs-Mail konnte gerade nicht gesendet werden. Der Termin ist trotzdem vorgemerkt.');setPayment('success');}catch(err){setPayment('idle');setError(err.message);}};
  const copyPayPalEmail=async()=>{try{await navigator.clipboard.writeText(PAYPAL_EMAIL);setPaypalEmailCopied(true);window.setTimeout(()=>setPaypalEmailCopied(false),2200);}catch{setError(`Bitte kopiere die PayPal-Adresse manuell: ${PAYPAL_EMAIL}`);}};
  const timeLeft=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;

  return <main className="booking-shell">
    <Summary service={service} date={date} slot={slot} onEdit={editStep}/>
    <section className="flow-panel">
      <button className="admin-entry" onClick={onAdmin}>Admin</button>
      <div className="progress-dots" aria-label={`Schritt ${step} von 4`}>{[1,2,3,4].map((item)=><span key={item} className={item<=step?'active':''}/>)}</div>
      {error&&<div className="flow-error" role="alert">{error}</div>}

      {step===1&&<div className="flow-content"><StepHeader step="1" title="Was darf es sein?" text="Wähle den gewünschten Service."/>
        {loading&&!services.length?<p className="loading-copy">Services werden geladen …</p>:<div className="service-options">{services.map((item)=><button key={item.id} onClick={()=>chooseService(item)}><span className="service-icon"><Sparkle size={19}/></span><span><strong>{item.name}</strong><small>{durationLabel(item.duration)}</small></span><ArrowRight size={20}/></button>)}</div>}
      </div>}

      {step===2&&<div className="flow-content"><button className="inline-back" onClick={()=>editStep(1)}><ArrowLeft size={17}/> Service</button><StepHeader step="2" title="Wähle deinen Termin" text="Es werden ausschließlich aktuell verfügbare, zur Behandlungsdauer passende Zeiten angezeigt."/>
        {loading&&!dates.length?<div className="date-hint"><Clock size={24}/><span>Die nächsten freien Tage werden gesucht …</span></div>:<div className="date-picker">{dates.map((item)=><button key={item.value} className={date?.value===item.value?'selected':''} onClick={()=>{setDate(item);setError('');}}><span>{item.day}</span><strong>{item.date}</strong><small>{item.month}</small></button>)}</div>}
        {date?<div className="times-section"><div className="times-label"><span><i/>Verfügbar am {date.full}</span><small>Zeitzone Berlin</small></div>{loading?<div className="date-hint"><Clock size={24}/><span>Freie Zeiten werden geprüft …</span></div>:slots.length?<div className="time-options">{slots.map((item)=><button key={item} className={slot===item?'selected':''} onClick={()=>setSlot(item)}>{item}</button>)}</div>:<div className="date-hint"><CalendarBlank size={24}/><span>An diesem Tag ist nichts mehr frei.</span></div>}</div>:<div className="date-hint"><CalendarBlank size={24}/><span>Wähle zuerst einen Tag.</span></div>}
        <button className="continue" disabled={!date||!slot||loading} onClick={reserveSlot}>10 Minuten reservieren <ArrowRight size={18}/></button>
      </div>}

      {step===3&&<div className="flow-content"><button className="inline-back" onClick={()=>editStep(2)}><ArrowLeft size={17}/> Termin</button><div className="reservation-bar"><Clock size={18}/><span>Serverseitig für dich reserviert</span><strong>{timeLeft}</strong></div><StepHeader step="3" title="Wie können wir dich erreichen?"/>
        <div className="contact-form"><label>Vorname<input autoFocus value={customer.firstName} onChange={updateCustomer('firstName')} placeholder="Dein Vorname"/></label><label>Nachname<input value={customer.lastName} onChange={updateCustomer('lastName')} placeholder="Dein Nachname"/></label><label className="wide">E-Mail<input type="email" value={customer.email} onChange={updateCustomer('email')} placeholder="name@beispiel.de"/></label><label className="wide">Mobilnummer<input type="tel" value={customer.phone} onChange={updateCustomer('phone')} placeholder="+49"/></label><label className="wide">Notiz <span>optional</span><textarea value={customer.note} onChange={updateCustomer('note')} placeholder="Gibt es etwas, das Zahra vorab wissen sollte?"/></label></div>
        <button className="continue" disabled={!contactValid} onClick={()=>setStep(4)}>Weiter zur Bestätigung <ArrowRight size={18}/></button>
      </div>}

      {step===4&&payment!=='success'&&<div className="flow-content"><button className="inline-back" onClick={()=>setStep(3)}><ArrowLeft size={17}/> Deine Daten</button><div className="reservation-bar"><Clock size={18}/><span>Serverseitig für dich reserviert</span><strong>{timeLeft}</strong></div><StepHeader step="4" title="Termin vormerken" text="Nach dem Vormerken sendest du die Anzahlung von 30 Euro per PayPal, damit Zahra den Termin final bestätigen kann."/>
        <div className="final-summary"><div><span>Service</span><strong>{service?.name}</strong></div><div><span>Datum</span><strong>{date?.full}</strong></div><div><span>Uhrzeit</span><strong>{slot} Uhr</strong></div><div><span>Dauer</span><strong>{durationLabel(service?.duration)}</strong></div><div className="deposit-row"><span>Anzahlung</span><strong>30,00 €</strong></div></div>
        <div className="deposit-terms"><strong>Regelung zur Anzahlung</strong><p>Für die verbindliche Reservierung wird eine Anzahlung von 30,00 € fällig. Die Zahlung kann per PayPal an {PAYPAL_EMAIL} gesendet werden. Der Termin bleibt vorgemerkt, bis Zahra den Zahlungseingang geprüft oder den Termin manuell angepasst hat. Eine einmalige Umbuchung ist bis spätestens 24 Stunden vor Terminbeginn ohne erneute Anzahlung möglich; die bereits geleistete Anzahlung wird auf den Ersatztermin übertragen.</p><p>Sagt Zahrashairgloss den Termin ab und kann kein Ersatztermin vereinbart werden, wird die Anzahlung vollständig zurückerstattet. Zwingende gesetzliche Ansprüche bleiben unberührt.</p></div>
        <label className="terms-checkbox"><input type="checkbox" checked={depositTermsAccepted} onChange={(event)=>setDepositTermsAccepted(event.target.checked)}/><span>Ich habe die Anzahlung und die Umbuchungsregel gelesen und bestätige sie ausdrücklich.</span></label>
        <button className="paypal pending-booking" onClick={pay} disabled={!depositTermsAccepted||payment==='loading'||seconds===0}>{payment==='loading'?'Termin wird vorgemerkt …':'Termin vormerken'}</button><p className="payment-note">Danach siehst du direkt den PayPal-QR-Code und alle Zahlungsdaten.</p>
      </div>}

      {payment==='success'&&<div className="success-view pending-payment-view">
        <header className="pending-payment-hero">
          <span className="pending-status-icon"><Clock size={27} weight="bold"/></span>
          <span className="success-kicker">{reservationEmailWarning?'Termin vorgemerkt':'Vorbestätigung gesendet'}</span>
          <h2>Termin vorgemerkt.<br/>Noch nicht bestätigt.</h2>
          <p>{reservationEmailWarning||'Du hast jetzt eine Reservierungsbestätigung bekommen. Die finale Bestätigung kommt erst, wenn Zahra die 30 € Anzahlung manuell freigibt.'}</p>
        </header>
        <section className="payment-action-card" aria-labelledby="deposit-title">
          <div className="payment-amount"><span id="deposit-title">Jetzt per PayPal anzahlen</span><strong>30,00 €</strong></div>
          <div className="payment-deadline"><Clock size={20} weight="bold"/><p><strong>Anzahlung jetzt senden</strong><span>Der Termin bleibt vorgemerkt, bis Zahra den Zahlungseingang geprüft hat.</span></p></div>
          <div className="paypal-payment-layout">
            <img className="paypal-qr" src={asset('/assets/paypal-qr.jpg')} alt="PayPal QR-Code für die Anzahlung von 30 Euro" />
            <div className="paypal-payment-copy"><span>PayPal-Empfänger</span><strong>{PAYPAL_EMAIL}</strong><ol><li>PayPal öffnen oder QR-Code scannen</li><li>30,00 € senden und deinen Namen angeben</li><li>Zahra prüft die Zahlung und bestätigt den Termin</li></ol><button className="paypal-primary" onClick={openPayPalSendMoney}>30 € mit PayPal anzahlen <ArrowRight size={17}/></button><button className="copy-paypal" onClick={copyPayPalEmail}>{paypalEmailCopied?'E-Mail kopiert':'PayPal-E-Mail kopieren'}</button></div>
          </div>
        </section>
        <section className="pending-appointment-card"><div><span>Vorgemerkter Termin</span><strong>{date?.full}, {slot} Uhr</strong><small>{service?.short}</small></div><span className="pending-badge">Anzahlung offen</span></section>
        <div className="confirmation-progress" aria-label="Status der Terminbestätigung"><div className="done"><i><Check size={13} weight="bold"/></i><span>Termin vorgemerkt</span></div><div className="current"><i>2</i><span>30 € anzahlen</span></div><div><i>3</i><span>Bestätigung durch Zahra</span></div></div>
        <p className="confirmation-note">Erst wenn Zahra den Zahlungseingang geprüft hat, ist dein Termin bestätigt. Danach geht eine finale Bestätigung raus.</p>
        <button className="new-booking-link" onClick={()=>window.location.reload()}>Weitere Buchung beginnen</button>
      </div>}
    </section>
  </main>;
}

const isoDate=(date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const addDays=(date,days)=>{const next=new Date(date);next.setDate(next.getDate()+days);return next;};
const addIsoDays=(value,days)=>isoDate(addDays(new Date(`${value}T12:00:00`),days));
const eachDateInRange=(fromDate,toDate)=>{const dates=[];for(let current=fromDate;current<=toDate;current=addIsoDays(current,1))dates.push(current);return dates;};
const startMonday=(date)=>{const day=date.getDay()||7;return addDays(date,1-day);};
const startMonth=(date)=>new Date(date.getFullYear(),date.getMonth(),1,12);
const addMonths=(date,months)=>new Date(date.getFullYear(),date.getMonth()+months,1,12);
const endMonth=(date)=>new Date(date.getFullYear(),date.getMonth()+1,0,12);

function AdminSheet({ title, onClose, children }) {
  return <div className="admin-sheet-layer"><button className="sheet-backdrop" onClick={onClose} aria-label="Schließen"/><section className="admin-sheet"><div className="sheet-handle"/><div className="sheet-title"><h2>{title}</h2><button onClick={onClose} aria-label="Schließen"><X size={20}/></button></div>{children}</section></div>;
}

function AdminLogin({ onAuthenticated, onExit }) {
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const submit=async(event)=>{event.preventDefault();setLoading(true);setError('');try{await api('/api/admin/login',{method:'POST',body:JSON.stringify({password})});onAuthenticated();}catch(err){setError(err.message);setPassword('');}finally{setLoading(false);}};
  return <main className="admin-login"><button className="login-exit" onClick={onExit}><ArrowLeft size={18}/> Buchungsseite</button><section><img src={asset('/assets/zahra-portrait.jpg')} alt="Zahra"/><span>Geschützter Bereich</span><h1>Willkommen,<br/>Zahra.</h1><p>Melde dich an, um Termine und freie Tage zu verwalten.</p><form onSubmit={submit}><label>Passwort<input autoFocus type="password" value={password} onChange={(event)=>setPassword(event.target.value)} autoComplete="current-password" placeholder="Dein Admin-Passwort"/></label>{error&&<div className="login-error" role="alert">{error}</div>}<button disabled={loading||!password}>{loading?'Anmeldung läuft …':'Sicher anmelden'} <ArrowRight size={18}/></button></form><small>Die Sitzung bleibt auf diesem Gerät 12 Stunden aktiv.</small></section></main>;
}

function ProtectedAdmin({ onExit }) {
  const [status,setStatus]=useState('loading');
  useEffect(()=>{api('/api/admin/session').then((data)=>setStatus(data.authenticated?'authenticated':'login')).catch(()=>setStatus('login'));},[]);
  if(status==='loading')return <main className="admin-auth-loading"><span/><p>Admin-Bereich wird geschützt geladen …</p></main>;
  if(status==='login')return <AdminLogin onExit={onExit} onAuthenticated={()=>setStatus('authenticated')}/>;
  return <Admin onExit={onExit} onLoggedOut={()=>setStatus('login')}/>;
}

function Admin({ onExit, onLoggedOut }) {
  const [services,setServices]=useState([]);
  const [serviceColors,setServiceColors]=useState(readServiceColors);
  const [monthStart,setMonthStart]=useState(startMonth(new Date()));
  const [selectedDate,setSelectedDate]=useState(isoDate(new Date()));
  const [bookings,setBookings]=useState([]);
  const [blocks,setBlocks]=useState([]);
  const [notifications,setNotifications]=useState([]);
  const [sheet,setSheet]=useState(null);
  const [selectedBooking,setSelectedBooking]=useState(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [bookingAlert,setBookingAlert]=useState(null);
  const [bookingSearch,setBookingSearch]=useState('');
  const seenBookingAlerts=useRef(readSeenBookingAlerts());
  const [manual,setManual]=useState({serviceId:'',date:isoDate(new Date()),time:'',firstName:'',lastName:'',email:'',phone:'',note:''});
  const [manualSlots,setManualSlots]=useState([]);
  const [freeDay,setFreeDay]=useState({fromDate:isoDate(new Date()),toDate:isoDate(new Date()),reason:'Frei'});
  const [move,setMove]=useState({date:isoDate(new Date()),time:''});
  const [moveSlots,setMoveSlots]=useState([]);
  const monthGridStart=startMonday(monthStart);
  const monthGridEnd=addDays(startMonday(endMonth(monthStart)),6);
  const monthDays=[];
  for(let day=monthGridStart;day<=monthGridEnd;day=addDays(day,1))monthDays.push(day);
  const calendarFrom=isoDate(monthGridStart);
  const calendarTo=isoDate(monthGridEnd);

  const receiveNotifications=(items)=>{
    setNotifications(items);
    const nextAlert=items.find((item)=>(item.type==='new_booking'||item.title==='Neue Online-Buchung')&&!item.readAt&&item.appointmentStartsAt&&!seenBookingAlerts.current.has(item.id));
    if(!nextAlert)return;
    seenBookingAlerts.current.add(nextAlert.id);
    rememberBookingAlert(seenBookingAlerts.current);
    setBookingAlert(nextAlert);
  };
  const refresh=async()=>{setError('');try{const [calendarData,notificationData,serviceData]=await Promise.all([api(`/api/admin/calendar?from=${calendarFrom}&to=${calendarTo}`),api('/api/admin/notifications'),api('/api/services')]);setBookings(calendarData.bookings);setBlocks(calendarData.blocks);receiveNotifications(notificationData.notifications);setServices(serviceData.services);setManual((value)=>({...value,serviceId:value.serviceId||serviceData.services[0]?.id||''}));}catch(err){setError(err.message);}};
  useEffect(()=>{refresh();},[monthStart]);
  useEffect(()=>{const check=()=>api('/api/admin/notifications').then((data)=>receiveNotifications(data.notifications)).catch(()=>{});const timer=window.setInterval(check,10000);const onVisible=()=>{if(document.visibilityState==='visible')check();};document.addEventListener('visibilitychange',onVisible);return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',onVisible);};},[]);
  useEffect(()=>{if(!manual.serviceId||!manual.date)return;api(`/api/availability?serviceId=${manual.serviceId}&date=${manual.date}`).then((data)=>setManualSlots(data.slots)).catch((err)=>setError(err.message));},[manual.serviceId,manual.date,sheet]);
  useEffect(()=>{if(sheet!=='move'||!selectedBooking||!move.date)return;api(`/api/availability?serviceId=${selectedBooking.serviceId}&date=${move.date}`).then((data)=>setMoveSlots(data.slots)).catch((err)=>setError(err.message));},[sheet,selectedBooking,move.date]);

  const dayBookings=bookings.filter((item)=>item.startsAt.slice(0,10)===selectedDate);
  const dayBlock=blocks.find((item)=>item.startsAt.slice(0,10)===selectedDate);
  const unread=notifications.filter((item)=>!item.readAt).length;
  const bookingById=new Map(bookings.map((item)=>[item.id,item]));
  const bookingSearchTerm=bookingSearch.trim().toLowerCase();
  const bookingSearchResults=bookingSearchTerm
    ? bookings.filter((item)=>{
        const haystack=[item.firstName,item.lastName,`${item.firstName} ${item.lastName}`,`${item.lastName} ${item.firstName}`]
          .join(' ')
          .toLowerCase();
        return haystack.includes(bookingSearchTerm);
      }).sort((a,b)=>a.startsAt.localeCompare(b.startsAt))
    : [];
  const selectedView=dateView(selectedDate);
  const selectedDateIsSunday = isSunday(selectedDate);
  const manualDateView=manual.date ? dateView(manual.date) : null;
  const manualDateIsSunday = manual.date ? isSunday(manual.date) : false;
  const moveDateView=move.date ? dateView(move.date) : null;
  const moveDateIsSunday = move.date ? isSunday(move.date) : false;
  const selectedManualService=services.find((item)=>item.id===manual.serviceId);
  const colorForService=(serviceId)=>serviceColors[serviceId]||DEFAULT_SERVICE_COLORS[serviceId]||'#b8acc7';
  const changeMonth=(months)=>{const next=addMonths(monthStart,months);setMonthStart(next);setSelectedDate(isoDate(next));};
  const flash=(message)=>{setNotice(message);window.setTimeout(()=>setNotice(''),2600);};
  const saveManual=async(event)=>{event.preventDefault();try{await api('/api/admin/bookings',{method:'POST',body:JSON.stringify({serviceId:manual.serviceId,date:manual.date,time:manual.time,customer:{firstName:manual.firstName,lastName:manual.lastName,email:manual.email,phone:manual.phone,note:manual.note}})});setSheet(null);setSelectedDate(manual.date);flash('Termin wurde eingetragen.');await refresh();}catch(err){setError(err.message);}};
  const saveFreeDay=async(event)=>{event.preventDefault();try{const result=await api('/api/admin/blocks',{method:'POST',body:JSON.stringify(freeDay)});setSheet(null);setSelectedDate(freeDay.fromDate);const count=result?.block?.count||result?.count||1;flash(count>1?`${count} freie Tage wurden gespeichert.`:'Freier Tag wurde gespeichert.');await refresh();}catch(err){setError(err.message);}};
  const removeBlock=async(id)=>{await api(`/api/admin/blocks/${id}`,{method:'DELETE'});flash('Tag ist wieder buchbar.');await refresh();};
  const cancelAppointment=async(id)=>{if(!window.confirm('Termin wirklich stornieren?'))return;await api(`/api/admin/bookings/${id}`,{method:'DELETE'});setSelectedBooking(null);setSheet(null);flash('Termin wurde storniert.');await refresh();};
  const saveMove=async(event)=>{event.preventDefault();try{await api(`/api/admin/bookings/${selectedBooking.id}`,{method:'PATCH',body:JSON.stringify(move)});setSheet(null);setSelectedDate(move.date);flash('Termin wurde verschoben.');await refresh();}catch(err){setError(err.message);}};
  const confirmDeposit=async()=>{try{const result=await api(`/api/admin/bookings/${selectedBooking.id}/payment`,{method:'POST',body:JSON.stringify({booking:{id:selectedBooking.id,serviceId:selectedBooking.serviceId,serviceName:selectedBooking.serviceName,serviceShort:selectedBooking.serviceShort,startsAt:selectedBooking.startsAt,firstName:selectedBooking.firstName,lastName:selectedBooking.lastName,email:selectedBooking.email,phone:selectedBooking.phone,note:selectedBooking.note,paymentStatus:'paid',confirmationStatus:'confirmed'}})});setSelectedBooking((current)=>current?{...current,paymentStatus:'paid',confirmationStatus:'confirmed'}:current);flash(result?.emailSent===false?'Anzahlung bestätigt, aber die Bestätigungsmail konnte nicht gesendet werden.':'Anzahlung bestätigt. Finale Bestätigung ist vorbereitet.');await refresh();}catch(err){setError(err.message);}};
  const updateServiceColor=(serviceId,color)=>setServiceColors((current)=>{const next={...current,[serviceId]:color};writeServiceColors(next);return next;});
  const openNotifications=async()=>{setBookingAlert(null);setSheet('notifications');if(unread){await api('/api/admin/notifications/read',{method:'POST',body:'{}'});setNotifications((items)=>items.map((item)=>({...item,readAt:item.readAt||new Date().toISOString()})));}};
  const openBookingMatch=(booking)=>{const bookingDate=new Date(`${booking.startsAt.slice(0,10)}T12:00:00`);setBookingSearch(`${booking.firstName} ${booking.lastName}`);setMonthStart(startMonth(bookingDate));setSelectedDate(booking.startsAt.slice(0,10));setSelectedBooking(booking);setSheet('details');};
  const logout=async()=>{await api('/api/admin/logout',{method:'POST',body:'{}'});onLoggedOut();};

  return <main className="admin-workspace">
    <header className="mobile-admin-header"><div className="admin-profile"><img src={asset('/assets/zahra-portrait.jpg')} alt="Zahra"/><div><span>Dein Studio</span><strong>Zahrashairgloss</strong></div></div><div className="admin-header-actions"><button onClick={openNotifications} aria-label="Benachrichtigungen"><Bell size={21}/>{unread>0&&<i>{unread}</i>}</button><button onClick={logout} aria-label="Sicher abmelden"><ArrowRight size={21}/></button></div></header>
    {bookingAlert&&<aside className="admin-booking-alert" role="alert" aria-live="assertive"><span className="booking-alert-icon"><Bell size={21} weight="fill"/></span><div><small>Neue Online-Buchung</small><strong>{bookingAlert.message?.split(' hat ')[0]||'Ein Kunde'}</strong><p>{new Intl.DateTimeFormat('de-DE',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(bookingAlert.appointmentStartsAt))} · {bookingAlert.appointmentStartsAt.slice(11,16)} Uhr</p>{bookingAlert.serviceName&&<em>{bookingAlert.serviceName}</em>}<button onClick={openNotifications}>Benachrichtigung öffnen</button></div><button className="booking-alert-close" onClick={()=>setBookingAlert(null)} aria-label="Hinweis schließen"><X size={17}/></button></aside>}
    <section className="admin-content">
      {error&&<div className="admin-message error" role="alert">{error}<button onClick={()=>setError('')}><X size={15}/></button></div>}{notice&&<div className="admin-message success"><Check size={16}/>{notice}</div>}
      <div className="admin-greeting"><div><span className="eyebrow">Kalender</span><h1>Hallo Zahra.</h1><p>{bookingSearchTerm?`${bookingSearchResults.length} Treffer für „${bookingSearch.trim()}“.`:dayBookings.length?`${dayBookings.length} ${dayBookings.length===1?'Termin':'Termine'} am ausgewählten Tag.`:'Der ausgewählte Tag ist noch frei.'}</p></div><button className="today-button" onClick={()=>{const today=new Date();setMonthStart(startMonth(today));setSelectedDate(isoDate(today));}}>Heute</button></div>
      <section className="admin-search-panel"><label className="admin-search"><span>Termin suchen</span><input type="search" value={bookingSearch} onChange={(e)=>setBookingSearch(e.target.value)} placeholder="Name eingeben, z. B. Anna Sommer"/>{bookingSearch&&<button type="button" onClick={()=>setBookingSearch('')}>Löschen</button>}</label>{bookingSearchTerm&&<div className="admin-search-results">{bookingSearchResults.length?bookingSearchResults.map((item)=><button key={item.id} type="button" className="search-result" onClick={()=>openBookingMatch(item)}><strong>{item.firstName} {item.lastName}</strong><span>{new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(item.startsAt))} · {item.startsAt.slice(11,16)} Uhr</span><small>{item.serviceShort}</small></button>):<div className="empty-search">Kein Termin mit diesem Namen gefunden.</div>}</div>}</section>

      <div className="month-card"><div className="month-toolbar"><button onClick={()=>changeMonth(-1)} aria-label="Vorheriger Monat"><CaretLeft size={19}/></button><strong>{new Intl.DateTimeFormat('de-DE',{month:'long',year:'numeric'}).format(monthStart)}</strong><button onClick={()=>changeMonth(1)} aria-label="Nächster Monat"><CaretRight size={19}/></button></div><div className="month-weekdays">{['Mo','Di','Mi','Do','Fr','Sa','So'].map((day)=><span key={day}>{day}</span>)}</div><div className="month-grid">{monthDays.map((day)=>{const value=isoDate(day);const count=bookings.filter((item)=>item.startsAt.slice(0,10)===value).length;const blocked=blocks.some((item)=>item.startsAt.slice(0,10)===value)||isSunday(value);const outside=day.getMonth()!==monthStart.getMonth();const today=value===isoDate(new Date());return <button key={value} className={`${selectedDate===value?'selected':''} ${blocked?'blocked':''} ${outside?'outside':''} ${today?'today':''}`} onClick={()=>{if(outside)setMonthStart(startMonth(day));setSelectedDate(value);}}><strong>{day.getDate()}</strong>{blocked?<i className="off-dot"/>:count>0?<i className="count-dot">{count}</i>:<i/>}</button>;})}</div></div>

      <div className="day-heading"><div><span>{selectedView.full}</span><h2>{selectedDateIsSunday?'Sonntag ist frei':dayBlock?'Freier Tag':'Tagesplan'}</h2></div>{selectedDateIsSunday?null:dayBlock?<button className="text-action danger" onClick={()=>removeBlock(dayBlock.id)}>Wieder öffnen</button>:<button className="text-action" onClick={()=>{setManual((value)=>({...value,date:selectedDate}));setSheet('booking');}}>+ Termin</button>}</div>
      {selectedDateIsSunday?<div className="day-off-card"><span><CalendarBlank size={22}/></span><div><strong>Sonntag</strong><p>Sonntags bleibt Zahrashairgloss immer geschlossen und ist nicht buchbar.</p></div></div>:dayBlock?<div className="day-off-card"><span><CalendarBlank size={22}/></span><div><strong>{dayBlock.reason}</strong><p>An diesem Tag werden keine Online-Termine angeboten.</p></div></div>:<div className="admin-agenda">{dayBookings.length?dayBookings.map((item)=><button className={`agenda-item ${hasOpenDeposit(item)?'pending-payment':''}`} key={item.id} onClick={()=>{setSelectedBooking(item);setSheet('details');}}><time>{item.startsAt.slice(11,16)}</time><span className={`agenda-line ${item.serviceId==='balayage'?'long':''} ${hasOpenDeposit(item)?'pending-payment':''}`} style={{background:hasOpenDeposit(item)?undefined:colorForService(item.serviceId)}}/><div><strong>{item.firstName} {item.lastName}</strong><p>{item.serviceShort} · {durationLabel(item.duration)}</p></div><span className={`booking-source ${item.paymentStatus==='manual'?'manual':hasOpenDeposit(item)?'pending':'online'}`}>{item.paymentStatus==='manual'?'Manuell':hasOpenDeposit(item)?'30 € offen':'Online'}</span><CaretRight size={17}/></button>):<div className="empty-day"><Clock size={25}/><strong>Noch keine Termine</strong><p>Nutze „Termin“, um diesen Tag manuell zu belegen.</p></div>}</div>}

      <section className="quick-overview"><h3>Dieser Monat</h3><div><span><strong>{bookings.filter((item)=>item.startsAt.slice(0,7)===isoDate(monthStart).slice(0,7)).length}</strong> Termine</span><span><strong>{bookings.filter((item)=>item.startsAt.slice(0,7)===isoDate(monthStart).slice(0,7)&&item.paymentStatus==='paid').length*30} €</strong> erhalten</span><span><strong>{blocks.filter((item)=>item.startsAt.slice(0,7)===isoDate(monthStart).slice(0,7)).length}</strong> freie Tage</span></div></section>
      <section className="service-color-card"><h3>Service-Farben</h3><div className="service-color-list">{services.map((item)=><div key={item.id} className="service-color-row"><div className="service-color-info"><span className="service-color-dot" style={{background:colorForService(item.id)}}/><strong>{item.short}</strong></div><div className="service-color-palette">{SERVICE_COLOR_PALETTE.map((color)=><button key={color} type="button" className={colorForService(item.id)===color?'selected':''} style={{background:color}} onClick={()=>updateServiceColor(item.id,color)} aria-label={`${item.short} Farbe ${color}`}/> )}</div></div>)}</div></section>
    </section>

    <nav className="admin-bottom-actions">{!selectedDateIsSunday&&<button onClick={()=>{setManual((value)=>({...value,date:selectedDate}));setSheet('booking');}}><Plus size={21}/><span>Termin</span></button>}<button onClick={()=>{setFreeDay({fromDate:selectedDate,toDate:selectedDate,reason:'Frei'});setSheet('free-day');}}><CalendarBlank size={21}/><span>Freier Tag</span></button></nav>

    {sheet==='booking'&&<AdminSheet title="Termin eintragen" onClose={()=>setSheet(null)}><form className="admin-form admin-form--booking" onSubmit={saveManual}><section className="booking-intro"><div><span className="booking-eyebrow">Manueller Termin</span><h3>{manualDateView?.full||'Datum wählen'} · {manual.time||'Uhrzeit wählen'}</h3><p>Hier legst du einen Termin direkt fest, elegant und ohne Slotschranken.</p></div><div className="booking-preview"><strong>{selectedManualService?.short||'Service'}</strong><span>{selectedManualService?durationLabel(selectedManualService.duration):'Dauer'}</span></div></section><label className="booking-field booking-field--service">Service<select value={manual.serviceId} onChange={(e)=>setManual({...manual,serviceId:e.target.value})}>{services.map((item)=><option key={item.id} value={item.id}>{item.short}</option>)}</select></label><div className="booking-time-grid"><label className="booking-field"><span>Datum</span><input type="date" value={manual.date} onChange={(e)=>setManual({...manual,date:e.target.value})}/>{manualDateView&&<small>Ausgewählt: {manualDateView.full}</small>}</label><label className="booking-field"><span>Uhrzeit</span><input type="time" list="manual-slot-suggestions" value={manual.time} onChange={(e)=>setManual({...manual,time:e.target.value})}/><datalist id="manual-slot-suggestions">{manualSlots.map((time)=><option key={time} value={time}/>)}</datalist>{manualSlots.length>0&&<small>{manualSlots.length>1?'Vorschläge': 'Vorschlag'} für diesen Tag</small>}</label></div>{manualDateIsSunday?<p className="sheet-note">Sonntag bleibt immer frei. Für Sonntage können keine Termine angelegt werden.</p>:manualSlots.length>0&&<div className="booking-slots">{manualSlots.map((time)=><button type="button" key={time} className={`slot-chip ${manual.time===time?'selected':''}`} onClick={()=>setManual({...manual,time})}>{time}</button>)}</div>}<p className="sheet-note">Im Admin kannst du jede Uhrzeit vergeben. Die Vorschläge sind nur eine Hilfe.</p><div className="form-pair"><label>Vorname<input required value={manual.firstName} onChange={(e)=>setManual({...manual,firstName:e.target.value})}/></label><label>Nachname<input required value={manual.lastName} onChange={(e)=>setManual({...manual,lastName:e.target.value})}/></label></div><label>Telefon <span>optional</span><input value={manual.phone} onChange={(e)=>setManual({...manual,phone:e.target.value})}/></label><label>Notiz <span>optional</span><textarea value={manual.note} onChange={(e)=>setManual({...manual,note:e.target.value})}/></label><button className="sheet-primary" disabled={!manual.time||manualDateIsSunday}>Termin speichern</button></form></AdminSheet>}
    {sheet==='free-day'&&<AdminSheet title="Freie Tage eintragen" onClose={()=>setSheet(null)}><form className="admin-form" onSubmit={saveFreeDay}><div className="form-pair"><label>Von<input type="date" value={freeDay.fromDate} onChange={(e)=>setFreeDay((current)=>{const fromDate=e.target.value;return {...current,fromDate,toDate:current.toDate<fromDate?fromDate:current.toDate};})}/></label><label>Bis<input type="date" min={freeDay.fromDate} value={freeDay.toDate} onChange={(e)=>setFreeDay({...freeDay,toDate:e.target.value})}/></label></div><label>Grund<select value={freeDay.reason} onChange={(e)=>setFreeDay({...freeDay,reason:e.target.value})}><option>Frei</option><option>Urlaub</option><option>Krank</option><option>Fortbildung</option><option>Privater Termin</option></select></label><p className="sheet-note">Der Zeitraum verschwindet sofort aus der Online-Buchung. Bestehende Termine im Zeitraum müssen vorher verschoben oder storniert werden.</p><button className="sheet-primary">{eachDateInRange(freeDay.fromDate,freeDay.toDate).length>1?'Zeitraum blockieren':'Tag blockieren'}</button></form></AdminSheet>}
    {sheet==='details'&&selectedBooking&&<AdminSheet title="Termindetails" onClose={()=>setSheet(null)}><div className="appointment-detail"><div className="detail-person"><span>{selectedBooking.firstName[0]}{selectedBooking.lastName[0]}</span><div><h3>{selectedBooking.firstName} {selectedBooking.lastName}</h3><p>{selectedBooking.phone||'Keine Telefonnummer'}</p></div></div><dl><div><dt>Uhrzeit Buchung</dt><dd>{selectedBooking.startsAt.slice(11,16)} Uhr</dd></div><div><dt>Service</dt><dd>{selectedBooking.serviceName}</dd></div><div><dt>Status</dt><dd><span className={`status-pill ${selectedBooking.confirmationStatus==='confirmed'?'confirmed':selectedBooking.paymentStatus==='paid'?'checked':'pending'}`}>{selectedBooking.confirmationStatus==='confirmed'?'Final bestätigt':selectedBooking.paymentStatus==='paid'?'Anzahlung geprüft, noch offen':'Reservierung vorgemerkt · 30 € offen'}</span></dd></div>{selectedBooking.reminderQueuedAt&&<div><dt>Erinnerung</dt><dd>{selectedBooking.reminderChannel==='sms'?'SMS':'E-Mail'} ist für 24h vorher eingeplant.</dd></div>}{selectedBooking.note&&<div><dt>Notiz</dt><dd>{selectedBooking.note}</dd></div>}</dl><div className="sheet-actions">{hasOpenDeposit(selectedBooking)&&<button className="sheet-secondary sheet-primary-action" onClick={confirmDeposit}><Check size={17}/> Anzahlung bestätigt</button>}<button className="sheet-secondary" onClick={()=>{setMove({date:selectedBooking.startsAt.slice(0,10),time:''});setSheet('move');}}><CalendarBlank size={17}/> Termin verschieben</button><button className="sheet-danger" onClick={()=>cancelAppointment(selectedBooking.id)}><Trash size={17}/> Termin stornieren</button></div></div></AdminSheet>}
    {sheet==='move'&&selectedBooking&&<AdminSheet title="Termin verschieben" onClose={()=>setSheet(null)}><form className="admin-form" onSubmit={saveMove}><p className="sheet-note">{selectedBooking.firstName} {selectedBooking.lastName} · {selectedBooking.serviceShort}</p><label>Neues Datum<input type="date" value={move.date} onChange={(e)=>setMove({...move,date:e.target.value})}/></label><label>Neue Uhrzeit<input type="time" list="move-slot-suggestions" value={move.time} onChange={(e)=>setMove({...move,time:e.target.value})}/><datalist id="move-slot-suggestions">{moveSlots.map((time)=><option key={time} value={time}/>)}</datalist></label>{moveDateIsSunday&&<p className="sheet-note">Sonntag bleibt immer frei. Auf Sonntage kann nicht verschoben werden.</p>}<p className="sheet-note">Auch beim Verschieben darf der Admin jede Uhrzeit setzen. Die Vorschläge sind optional.</p><button className="sheet-primary" disabled={!move.time||moveDateIsSunday}>Verschieben</button></form></AdminSheet>}
    {sheet==='notifications'&&<AdminSheet title="Benachrichtigungen" onClose={()=>setSheet(null)}><div className="notification-list">{notifications.length?notifications.map((item)=>{const relatedBooking=bookingById.get(item.bookingId);const appointmentStartsAt=item.appointmentStartsAt||relatedBooking?.startsAt||null;const serviceName=item.serviceName||relatedBooking?.serviceName||relatedBooking?.serviceShort||'';return <article key={item.id} className={!item.readAt?'unread':''}><span><Bell size={17}/></span><div><strong>{item.title}</strong><p>{item.message}</p>{appointmentStartsAt&&<b>{new Intl.DateTimeFormat('de-DE',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(appointmentStartsAt))} · {appointmentStartsAt.slice(11,16)} Uhr{serviceName?` · ${serviceName}`:''}</b>}<small>{new Intl.DateTimeFormat('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(item.createdAt))}</small></div></article>; }):<div className="empty-notifications">Keine neuen Benachrichtigungen.</div>}</div></AdminSheet>}
  </main>;
}

export function App(){const[admin,setAdmin]=useState(false);return admin?<ProtectedAdmin onExit={()=>setAdmin(false)}/>:<BookingApp onAdmin={()=>setAdmin(true)}/>;}
