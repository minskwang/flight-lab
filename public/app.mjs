import { createSimulator } from './simulator.mjs';
const $ = id => document.getElementById(id);
const simulator = createSimulator();
let recognition, active = false, busy = false, generation = 0, aborter;
let records = [], history = [], sessionNumber = 0;
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
const modes = { grounded: 'Am Boden', airborne: 'In der Luft · Simulation', emergency_stopped: 'Not-Stopp aktiv' };
const actions = { takeoff: 'Starten', land: 'Landen', hover: 'Schweben', emergency_stop: 'Not-Stopp', reset: 'Zurücksetzen' };
const numberDE = (value, digits = 2) => Number(value).toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
function status(text, cls = '') { $('status').textContent = text; $('dot').className = `dot ${cls}`; }
function notice(text) { $('notice').textContent = text; }
function mark(id) { $(id).classList.add('ok'); }
function renderState() {
  const s = simulator.snapshot(); $('flightMode').textContent = modes[s.mode];
  for (const [id, value] of [['posForward',s.position.forward],['posRight',s.position.right],['posVertical',s.position.vertical]]) $(id).textContent = numberDE(value, 3);
  $('posYaw').textContent = numberDE(s.yaw_degrees, 1);
  const x = Math.max(-150,Math.min(150,s.position.right * 70)); const y = Math.max(-80,Math.min(80,-s.position.forward * 70));
  $('drone').style.transform = `translate(calc(-50% + ${x}px),calc(-50% + ${y}px)) rotate(${s.yaw_degrees}deg)`;
}
function addTranscript(role, text, source = 'Jev') {
  const entry = { time: new Date().toISOString(), session: sessionNumber, role, text, source }; history.push(entry);
  $('transcripts').querySelector('.empty')?.remove();
  const div = document.createElement('div'); div.className = `entry ${role === 'KI' ? 'ai' : ''}`;
  const label = document.createElement('small'); label.textContent = `${role} · ${source}`;
  const content = document.createElement('span'); content.textContent = text;
  div.append(label, content); $('transcripts').append(div); $('transcripts').scrollTop = $('transcripts').scrollHeight;
}
function record(call, source = 'TypeSafe Jev') {
  const item = { time: new Date().toISOString(), session: sessionNumber, source, ...call }; records.push(item);
  $('calls').querySelector('.empty')?.remove();
  const div = document.createElement('div'); div.className = `call ${call.result.ok ? '' : 'failed'}`;
  const title = document.createElement('div'); title.className = 'call-title';
  const name = document.createElement('strong'); name.textContent = call.name === 'move_drone' ? 'Bewegung' : call.name === 'get_drone_status' ? 'Statusabfrage' : actions[call.arguments?.action] || call.name;
  const verdict = document.createElement('span'); verdict.textContent = `${source} · ${call.result.ok ? 'Simulation erfolgreich' : 'Abgelehnt'}`;
  title.append(name, verdict);
  const description = document.createElement('p'); description.className = 'command-summary';
  if (!call.result.ok) description.textContent = call.result.error;
  else if (call.name === 'move_drone') {
    const a = call.arguments;
    description.textContent = `Vorwärts: ${numberDE(a.forward)} · Rechts: ${numberDE(a.right)} · Aufwärts: ${numberDE(a.vertical)} · Drehung: ${numberDE(a.yaw)} · Dauer: ${a.duration_ms} ms`;
  } else description.textContent = `Zustand: ${modes[call.result.state?.mode] || 'Unbekannt'} · Nur Simulation`;
  const details = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = `Parameter und Ergebnis ansehen · ${call.name}`;
  const pre = document.createElement('pre'); pre.textContent = JSON.stringify({ arguments: call.arguments, result: call.result, call_id: call.call_id, decisions: call.decisions }, null, 2);
  details.append(summary, pre);
  div.append(title, description, details); $('calls').prepend(div); renderState();
  if (source === 'TypeSafe Jev') { mark('stepTool'); mark('stepUI'); }
}
function updateButtons() {
  $('connect').disabled = active;
  $('disconnect').disabled = !active;
  $('mute').disabled = !active || !Speech || busy || !!recognition;
  $('send').disabled = !active || busy || !!recognition;
  $('demo').disabled = active;
  $('language').disabled = !!recognition;
}
function disconnect(message = 'Getrennt') {
  generation++; aborter?.abort(); aborter = null;
  const old = recognition; recognition = null; old?.abort();
  active = false; busy = false; $('micStatus').textContent = 'Inaktiv';
  status(message); $('activity').textContent = message; updateButtons();
}
async function submit(text, source = 'Texteingabe') {
  if (!active || busy || !text.trim()) return;
  const token = generation;
  busy = true; updateButtons(); addTranscript('Du',text,source);
  $('activity').textContent = 'Jev entscheidet…';
  const controller = new AbortController(); aborter = controller;
  const timeout = setTimeout(() => controller.abort(),25000);
  try {
    const response = await fetch('/api/decide',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,state:simulator.snapshot()}),signal:aborter.signal});
    const result = await response.json();
    if (token !== generation) return;
    if (!response.ok) throw new Error(result.error || 'Jev-Anfrage fehlgeschlagen');
    mark('stepAI');
    if (result.command) {
      const call = result.command;
      record({...call,call_id:crypto.randomUUID(),decisions:result.decisions,result:simulator.execute(call.name,call.arguments)});
      addTranscript('KI','Entscheidung: '+(actions[call.arguments.action] || (call.name === 'move_drone' ? 'Bewegung' : 'Statusabfrage')),'Jev · feste Anzeige');
      notice('Jev-Entscheidung empfangen. Ergebnis und Konfidenz stehen im Protokoll.');
    } else {
      addTranscript('KI',result.reason,'Jev · keine Aktion');
      records.push({time:new Date().toISOString(),source:'TypeSafe Jev',...result});
      notice(result.reason);
    }
    $('activity').textContent = 'Fertig. Nächsten Flugwunsch eingeben oder aufnehmen.';
  } catch(e) {
    if (token === generation) { notice(e.name === 'AbortError' ? 'Zeitüberschreitung. Keine Aktion ausgeführt.' : e.message); $('activity').textContent = 'Anfrage fehlgeschlagen'; }
  } finally { clearTimeout(timeout); if (token === generation) { busy = false; aborter = null; updateButtons(); } }
}
async function connect() {
  const token = ++generation;
  try {
    const h = await fetch('/api/health').then(r=>r.json());
    if (token !== generation) return;
    if (!h.keyConfigured) { $('setup').open = true; throw new Error('TypeSafe-Schlüssel fehlt. Öffne configure-typesafe-key.cmd und speichere ihn lokal.'); }
    sessionNumber++; simulator.reset(); renderState(); active = true;
    for(const id of ['stepMic','stepAI','stepTool','stepUI']) $(id).classList.remove('ok');
    status('Jev bereit · Noch keine API-Anfrage', 'connected');
    notice(Speech ? 'Text senden oder „Sprachbefehl aufnehmen“ wählen. Ein Befehl pro Aufnahme.' : 'Spracherkennung wird hier nicht unterstützt. Texteingabe ist verfügbar; für Sprache Chrome versuchen.');
    $('activity').textContent = 'Bereit für deinen Flugwunsch'; updateButtons();
  } catch(e) { if(token === generation) { status('Einrichtung erforderlich','error'); notice(e.message); } }
}
$('connect').onclick = connect;
$('disconnect').onclick = () => disconnect();
$('mute').onclick = () => {
  if(!Speech || !active || busy || recognition) return;
  const token = generation, rec = new Speech(); recognition = rec;
  rec.lang = $('language').value; rec.continuous = false; rec.interimResults = false;
  let received = false;
  rec.onstart = () => { if(token === generation && recognition === rec) { mark('stepMic'); $('micStatus').textContent = 'Hört zu…'; } };
  rec.onresult = event => {
    if(token !== generation || received || recognition !== rec) return;
    const result = event.results[event.resultIndex];
    if(result?.isFinal) { received = true; recognition = null; rec.abort(); $('micStatus').textContent = 'Inaktiv'; submit(result[0].transcript,'Mikrofon'); }
  };
  rec.onerror = event => { if(token === generation && recognition === rec) notice('Spracherkennung: '+event.error+'. Texteingabe bleibt verfügbar.'); };
  rec.onend = () => { if(token === generation && recognition === rec) { recognition = null; $('micStatus').textContent = 'Inaktiv'; updateButtons(); } };
  try { rec.start(); updateButtons(); } catch { recognition = null; notice('Spracherkennung nicht verfügbar. Bitte Text eingeben.'); updateButtons(); }
};
$('textForm').onsubmit = e => { e.preventDefault(); if(!active || busy || recognition) return; const text = $('textInput').value.trim(); if(text) { submit(text); $('textInput').value = ''; } };
document.querySelectorAll('[data-text]').forEach(button => button.onclick = () => { $('textInput').value = button.dataset.text; $('textInput').focus(); });
$('stop').onclick = () => { disconnect('Not-Stopp · Getrennt'); const result = simulator.execute('flight_action',{action:'emergency_stop'}); record({name:'flight_action',arguments:{action:'emergency_stop'},result,call_id:crypto.randomUUID()},'Lokale Taste'); notice('Die Simulation wurde gestoppt. Mikrofon und KI sind getrennt. Beim erneuten Verbinden beginnt eine neue Simulation.'); };
$('demo').onclick = () => {
  simulator.reset(); renderState();
  for (const id of ['stepMic','stepAI','stepTool','stepUI']) $(id).classList.remove('ok');
  notice('Lokale Demo mit festen Beispieldaten. Mikrofon und KI werden nicht verwendet; dies ist kein Nachweis einer Jev-Verbindung.');
  const calls = [['flight_action',{action:'takeoff'}],['move_drone',{forward:0.2,right:-0.15,vertical:0,yaw:0,duration_ms:350}],['get_drone_status',{}]];
  for (const [name,args] of calls) record({name,arguments:args,result:simulator.execute(name,args),call_id:crypto.randomUUID()},'Lokale Demo · Ohne KI');
};
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ exportedAt:new Date().toISOString(), simulation_only:true, records, transcripts:history },null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download='flight-lab-test.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); };
window.addEventListener('pagehide',() => disconnect());
renderState();
updateButtons();
fetch('/api/health').then(r=>r.json()).then(h=>{ $('model').textContent = 'TypeSafe · '+h.model; status(h.keyConfigured ? 'Lokaler Dienst bereit' : 'TypeSafe-Schlüssel fehlt'); if(!h.keyConfigured) $('setup').open = true; }).catch(()=>status('Lokaler Dienst nicht erreichbar','error'));
