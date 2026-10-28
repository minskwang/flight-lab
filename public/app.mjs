import { createSimulator, processResponse } from './simulator.mjs';
const $ = id => document.getElementById(id);
const simulator = createSimulator();
let pc, dc, stream, connecting = false, busy = false, generation = 0, aborter, timer;
let records = [], history = [], sessionNumber = 0, seen = new Set();
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
function addTranscript(role, text, source = 'Realtime') {
  const entry = { time: new Date().toISOString(), session: sessionNumber, role, text, source }; history.push(entry);
  $('transcripts').querySelector('.empty')?.remove();
  const div = document.createElement('div'); div.className = `entry ${role === 'KI' ? 'ai' : ''}`;
  const label = document.createElement('small'); label.textContent = `${role} · ${source}`;
  const content = document.createElement('span'); content.textContent = text;
  div.append(label, content); $('transcripts').append(div); $('transcripts').scrollTop = $('transcripts').scrollHeight;
}
function record(call, source = 'OpenAI Realtime') {
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
  if (source === 'OpenAI Realtime') { mark('stepTool'); mark('stepUI'); }
}
function send(event) { if(dc?.readyState === 'open') dc.send(JSON.stringify(event)); }
function updateButtons() {
  const online = dc?.readyState === 'open';
  $('connect').disabled = connecting || online;
  $('disconnect').disabled = !connecting && !pc;
  $('mute').disabled = !online;
  $('send').disabled = !online || busy;
  $('demo').disabled = connecting || online;
}
function disconnect(message = 'Getrennt') {
  generation++; clearTimeout(timer); aborter?.abort(); aborter = null;
  const channel=dc; dc=null; channel?.close();
  const peer=pc; pc=null; peer?.close();
  stream?.getTracks().forEach(t=>t.stop()); stream=null;
  connecting=false; busy=false; $('micStatus').textContent='Inaktiv'; $('mute').textContent='Mikrofon pausieren';
  status(message); $('activity').textContent=message; updateButtons();
}
function onEvent(event) {
  if(event.type === 'input_audio_buffer.speech_started') $('activity').textContent='Ich höre zu…';
  if(event.type === 'conversation.item.input_audio_transcription.completed') addTranscript('Du',event.transcript || '(Kein Text erkannt)','Mikrofon');
  if(event.type === 'conversation.item.input_audio_transcription.failed') notice('Transkription fehlgeschlagen. Bitte erneut sprechen.');
  if(event.type === 'response.created') {busy=true;updateButtons();}
  if(event.type === 'response.done') {
    busy=false;
    for(const item of event.response?.output || []) for(const c of item.content || []) if(c.text || c.transcript) addTranscript('KI',c.text || c.transcript);
    processResponse(event,simulator,seen,send,record);
    $('activity').textContent=event.response?.status === 'completed' ? 'Fertig. Du kannst weitersprechen.' : 'Antwort nicht abgeschlossen.';
    if(event.response?.status === 'failed') notice('OpenAI-Antwort fehlgeschlagen. Guthaben und Modellzugriff prüfen.');
    updateButtons();
  }
  if(event.type === 'error') {busy=false;updateButtons();notice('Fehler in der OpenAI-Sitzung. Bitte erneut verbinden.');}
}
async function connect() {
  if(connecting || pc) return;
  const token=++generation; connecting=true; updateButtons();
  for(const id of ['stepMic','stepAI','stepTool','stepUI']) $(id).classList.remove('ok');
  const controller=new AbortController(); aborter=controller;
  timer=setTimeout(()=>{if(token===generation) {disconnect('Zeitüberschreitung');notice('Verbindung nach 45 Sekunden abgebrochen.');}},45000);
  try {
    status('OpenAI-Konfiguration wird geprüft…');
    const healthResponse=await fetch('/api/health',{signal:controller.signal});
    if(!healthResponse.ok) throw new Error('Dienst nicht verfügbar. Anmeldung und Server prüfen.');
    const h=await healthResponse.json(); if(token!==generation) return;
    if(!h.keyConfigured) { $('setup').open=true; throw new Error('OpenAI-Schlüssel fehlt. Lokal configure-key.cmd öffnen; in Render OPENAI_API_KEY setzen.'); }
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon benötigt HTTPS oder localhost und einen unterstützten Browser.');
    status('Mikrofonfreigabe erforderlich…');
    const media=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
    if(token!==generation) {media.getTracks().forEach(t=>t.stop());return;}
    stream=media; mark('stepMic'); $('micStatus').textContent='Aktiv';
    sessionNumber++; simulator.reset(); renderState(); seen=new Set();
    const peer=new RTCPeerConnection(); pc=peer;
    stream.getTracks().forEach(t=>peer.addTrack(t,stream));
    const channel=peer.createDataChannel('oai-events'); dc=channel;
    channel.onmessage=e=>{if(token===generation) {try{onEvent(JSON.parse(e.data));}catch{notice('Sitzungsereignis konnte nicht verarbeitet werden.');}}};
    channel.onopen=()=>{if(token!==generation)return;clearTimeout(timer);connecting=false;mark('stepAI');status('Verbunden · Sprich jetzt','connected');notice('Audio wird an OpenAI übertragen. Deutsch, Englisch und Chinesisch werden automatisch verstanden. Nach dem Test trennen.');updateButtons();};
    channel.onclose=()=>{if(token===generation)disconnect('Verbindung geschlossen');};
    peer.onconnectionstatechange=()=>{if(token===generation && ['failed','disconnected'].includes(peer.connectionState))disconnect('Netzwerkverbindung unterbrochen');};
    const offer=await peer.createOffer(); if(token!==generation)return;
    await peer.setLocalDescription(offer); if(token!==generation)return;
    const response=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/sdp'},body:offer.sdp,signal:controller.signal});
    if(!response.ok) {const error=await response.json().catch(()=>({}));throw new Error(error.error || 'OpenAI-Verbindung fehlgeschlagen');}
    const answer=await response.text();if(token!==generation)return;
    await peer.setRemoteDescription({type:'answer',sdp:answer});
  } catch(e) {
    if(token!==generation)return;
    disconnect('Nicht verbunden');status('Verbindung fehlgeschlagen','error');
    notice(e.name==='NotAllowedError' ? 'Bitte Mikrofonzugriff im Browser erlauben.' : e.message);
  }
}
$('connect').onclick=connect;
$('disconnect').onclick=()=>disconnect();
$('mute').onclick=()=>{const track=stream?.getAudioTracks()[0];if(!track)return;track.enabled=!track.enabled;$('mute').textContent=track.enabled?'Mikrofon pausieren':'Mikrofon fortsetzen';$('micStatus').textContent=track.enabled?'Aktiv':'Pausiert';};
$('textForm').onsubmit=e=>{e.preventDefault();const text=$('textInput').value.trim();if(!text || dc?.readyState!=='open' || busy)return;addTranscript('Du',text,'Texteingabe');send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});send({type:'response.create'});busy=true;updateButtons();$('textInput').value='';};
document.querySelectorAll('[data-text]').forEach(button => button.onclick = () => { $('textInput').value = button.dataset.text; $('textInput').focus(); });
$('stop').onclick = () => { disconnect('Not-Stopp · Getrennt'); const result = simulator.execute('flight_action',{action:'emergency_stop'}); record({name:'flight_action',arguments:{action:'emergency_stop'},result,call_id:crypto.randomUUID()},'Lokale Taste'); notice('Die Simulation wurde gestoppt. Mikrofon und KI sind getrennt. Beim erneuten Verbinden beginnt eine neue Simulation.'); };
$('demo').onclick = () => {
  simulator.reset(); renderState();
  for (const id of ['stepMic','stepAI','stepTool','stepUI']) $(id).classList.remove('ok');
  notice('Lokale Demo mit festen Beispieldaten. Mikrofon und KI werden nicht verwendet; dies ist kein Nachweis einer Realtime-Verbindung.');
  const calls = [['flight_action',{action:'takeoff'}],['move_drone',{forward:0.2,right:-0.15,vertical:0,yaw:0,duration_ms:350}],['get_drone_status',{}]];
  for (const [name,args] of calls) record({name,arguments:args,result:simulator.execute(name,args),call_id:crypto.randomUUID()},'Lokale Demo · Ohne KI');
};
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ exportedAt:new Date().toISOString(), simulation_only:true, records, transcripts:history },null,2)],{type:'application/json'}); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href=url; link.download='flight-lab-test.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); };
window.addEventListener('pagehide',() => disconnect());
renderState();
updateButtons();
fetch('/api/health').then(r=>r.json()).then(h=>{ $('model').textContent = 'OpenAI · '+h.model; status(h.keyConfigured ? 'Lokaler Dienst bereit' : 'OpenAI-Schlüssel fehlt'); if(!h.keyConfigured) $('setup').open = true; }).catch(()=>status('Lokaler Dienst nicht erreichbar','error'));
