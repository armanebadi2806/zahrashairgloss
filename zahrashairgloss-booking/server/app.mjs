import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createDatabase } from './database.mjs';
import { createAuth } from './auth.mjs';
import { TERMS_VERSION, cancelBooking, confirmDemoPayment, createBlockedPeriod, createHold, createManualBooking, deleteBlockedPeriod, listAvailableSlots, listBlockedPeriods, listBookableDates, listBookings, listBookingsRange, listNotifications, listServices, markNotificationsRead, releaseHold, rescheduleBooking } from './booking-service.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
try { process.loadEnvFile(join(root,'.env')); } catch {}
const db=createDatabase(process.env.DATABASE_PATH||join(root,'data','zahrashairgloss.sqlite'));
const auth=createAuth(db);
const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function readJson(req){let body='';for await(const chunk of req){body+=chunk;if(body.length>50_000)throw new Error('Anfrage ist zu groß.');}return body?JSON.parse(body):{};}

async function api(req,res,url){
  try{
    if(req.method==='GET'&&url.pathname==='/api/config')return send(res,200,{depositCents:3000,holdMinutes:10,termsVersion:TERMS_VERSION,timezone:'Europe/Berlin'});
    if(req.method==='GET'&&url.pathname==='/api/services')return send(res,200,{services:listServices(db)});
    if(req.method==='GET'&&url.pathname==='/api/dates')return send(res,200,{dates:listBookableDates(db,{serviceId:url.searchParams.get('serviceId')})});
    if(req.method==='GET'&&url.pathname==='/api/availability')return send(res,200,{slots:listAvailableSlots(db,url.searchParams.get('serviceId'),url.searchParams.get('date'))});
    if(req.method==='POST'&&url.pathname==='/api/holds')return send(res,201,{hold:createHold(db,await readJson(req))});
    if(req.method==='DELETE'&&url.pathname.startsWith('/api/holds/')){releaseHold(db,url.pathname.split('/').pop());return send(res,200,{released:true});}
    if(req.method==='POST'&&url.pathname==='/api/bookings/confirm-demo-payment')return send(res,201,{booking:confirmDemoPayment(db,await readJson(req))});
    if(req.method==='GET'&&url.pathname==='/api/admin/session')return send(res,200,{authenticated:Boolean(auth.session(req)),configured:auth.configured});
    if(req.method==='POST'&&url.pathname==='/api/admin/login'){auth.login(req,res,(await readJson(req)).password);return send(res,200,{authenticated:true});}
    if(req.method==='POST'&&url.pathname==='/api/admin/logout'){auth.logout(req,res);return send(res,200,{authenticated:false});}
    if(url.pathname.startsWith('/api/admin/')&&!auth.session(req))return send(res,401,{error:'Bitte zuerst im Admin-Bereich anmelden.'});
    if(req.method==='GET'&&url.pathname==='/api/admin/bookings'){const date=url.searchParams.get('date')||new Date().toISOString().slice(0,10);return send(res,200,{bookings:listBookings(db,date)});}
    if(req.method==='GET'&&url.pathname==='/api/admin/calendar'){const from=url.searchParams.get('from');const to=url.searchParams.get('to');return send(res,200,{bookings:listBookingsRange(db,from,to),blocks:listBlockedPeriods(db,from,to)});}
    if(req.method==='POST'&&url.pathname==='/api/admin/bookings')return send(res,201,{booking:createManualBooking(db,await readJson(req))});
    if(req.method==='PATCH'&&url.pathname.startsWith('/api/admin/bookings/'))return send(res,200,{booking:rescheduleBooking(db,url.pathname.split('/').pop(),await readJson(req))});
    if(req.method==='DELETE'&&url.pathname.startsWith('/api/admin/bookings/')){cancelBooking(db,url.pathname.split('/').pop());return send(res,200,{cancelled:true});}
    if(req.method==='POST'&&url.pathname==='/api/admin/blocks')return send(res,201,{block:createBlockedPeriod(db,await readJson(req))});
    if(req.method==='DELETE'&&url.pathname.startsWith('/api/admin/blocks/')){deleteBlockedPeriod(db,url.pathname.split('/').pop());return send(res,200,{deleted:true});}
    if(req.method==='GET'&&url.pathname==='/api/admin/notifications')return send(res,200,{notifications:listNotifications(db)});
    if(req.method==='POST'&&url.pathname==='/api/admin/notifications/read'){markNotificationsRead(db);return send(res,200,{read:true});}
    return send(res,404,{error:'Nicht gefunden.'});
  }catch(error){
    const status=/Zu viele Versuche/.test(error.message)?429:/Passwort ist nicht korrekt/.test(error.message)?401:/nicht mehr verfügbar|abgelaufen/.test(error.message)?409:400;
    return send(res,status,{error:error.message||'Unbekannter Fehler.'});
  }
}

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
function staticFile(res,pathname){const dist=join(root,'dist');let file=join(dist,pathname==='/'?'index.html':pathname);if(!file.startsWith(dist)||!existsSync(file)||statSync(file).isDirectory())file=join(dist,'index.html');res.writeHead(200,{'Content-Type':`${mime[extname(file)]||'application/octet-stream'}; charset=utf-8`});createReadStream(file).pipe(res);}

export function startServer({port=Number(process.env.PORT||8787),host=process.env.HOST||'0.0.0.0',serveFrontend=process.env.SERVE_FRONTEND==='true'}={}){
  const server=createServer(async(req,res)=>{const url=new URL(req.url,`http://${req.headers.host||`${host}:${port}`}`);if(url.pathname.startsWith('/api/'))return api(req,res,url);if(serveFrontend)return staticFile(res,url.pathname);return send(res,404,{error:'Frontend läuft über Vite.'});});
  return new Promise((resolveServer)=>server.listen(port,host,()=>resolveServer(server)));
}
if(process.argv[1]===fileURLToPath(import.meta.url))startServer().then(()=>console.log(`Zahrashairgloss API läuft auf Port ${process.env.PORT||8787}`));
