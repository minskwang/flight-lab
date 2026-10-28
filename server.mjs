import http from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decide } from './jev.mjs';
import { deploymentAccess } from './access.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const deployment = deploymentAccess(process.env, port);
const allowedHosts = deployment.hosts;
const allowedOrigins = deployment.origins;
const model = process.env.TYPESAFE_MODEL || 'jev-latest';
const secretFile = path.join(root, 'secrets', 'typesafe-key.dpapi');
const exec = promisify(execFile);
async function hasKey() { if (process.env.TYPESAFE_API_KEY) return true; try { await access(secretFile); return true; } catch { return false; } }
async function getKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'read-typesafe-key.ps1')], { windowsHide: true, timeout: 10000, maxBuffer: 16000 });
    return stdout.trim();
  } catch { throw new Error('KEY_UNAVAILABLE'); }
}
function reply(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'", 'Permissions-Policy': 'microphone=(self), camera=()' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
async function readBody(req) { let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 65536) throw new Error('TOO_LARGE'); } return text; }
let pending = false;
let lastApiError = null;
export const server = http.createServer(async (req, res) => {
  if (!allowedHosts.has(req.headers.host)) return reply(res, 403, { error: 'Nur lokale Verbindungen sind erlaubt' });
  if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return reply(res, 403, { error: 'Anfrage von einer fremden Webseite blockiert' });
  if (!deployment.authorize(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Flight Lab", charset="UTF-8"');
    return reply(res, 401, { error: 'Bitte mit Benutzername flightlab und Website-Passwort anmelden.' });
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return reply(res, 200, { ok: true, keyConfigured: await hasKey(), model, simulation: true, lastApiError });
    if (req.method === 'POST' && ['/api/decide', '/api/session'].includes(url.pathname)) {
      if (!allowedOrigins.has(req.headers.origin) || req.headers['content-type'] !== 'application/json') return reply(res, 403, { error: 'Bitte über die lokale Testseite verbinden' });
      if (url.pathname === '/api/session') return reply(res, 410, { error: 'Realtime wurde durch Jev ersetzt.' });
      let input;
      try { input = JSON.parse(await readBody(req)); } catch (e) { return reply(res, e.message === 'TOO_LARGE' ? 413 : 400, { error: 'Ungültige Anfrage' }); }
      if (typeof input?.text !== 'string' || !input.text.trim() || input.text.length > 1000 || !['grounded','airborne','emergency_stopped'].includes(input.state?.mode)) return reply(res,400,{error:'Ungültiger Flugwunsch oder Simulationszustand'});
      if (!(await hasKey())) return reply(res,503,{error:'TypeSafe-Schlüssel fehlt. Öffne configure-typesafe-key.cmd im Projektordner.'});
      if (pending) return reply(res,429,{error:'Eine Entscheidung läuft bereits. Bitte warten.'});
      pending = true;
      try {
        const decision = await decide(input.text.trim(), {mode: input.state.mode}, await getKey());
        lastApiError = null;
        return reply(res,200,decision);
      } catch (e) {
        const message = /^(TypeSafe|Ungültige Jev)/.test(e.message) ? e.message : 'Jev nicht erreichbar oder Zeitüberschreitung. Keine Aktion ausgeführt.';
        lastApiError = { message };
        return reply(res,502,{error:message});
      } finally { pending = false; }
    }
    const files = { '/': ['index.html','text/html; charset=utf-8'], '/app.mjs': ['app.mjs','text/javascript; charset=utf-8'], '/simulator.mjs': ['simulator.mjs','text/javascript; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'] };
    if (req.method === 'GET' && files[url.pathname]) { const [file, type] = files[url.pathname]; return reply(res, 200, await readFile(path.join(root,'public',file),'utf8'), type); }
    reply(res, 404, { error: 'Nicht gefunden' });
  } catch (error) {
    reply(res, error.message === 'TOO_LARGE' ? 413 : 502, { error: error.message === 'KEY_UNAVAILABLE' ? 'Der lokale Schlüssel kann nicht entschlüsselt werden. Führe configure-typesafe-key.cmd mit deinem aktuellen Windows-Benutzer erneut aus.' : 'Verbindung fehlgeschlagen oder Zeitüberschreitung. Prüfe das Netzwerk und versuche es erneut.' });
  }
});
server.listen(port, deployment.bind, () => console.log(`Drone simulator listening on port ${port} (simulation only)`));
