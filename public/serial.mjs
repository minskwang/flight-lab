// Protocol for jugend-msp-reader 0.2.0. Only read-only commands are allowed.
export function decodeReply(command, line) {
  const data = JSON.parse(line);
  if (data.ok === false) throw new Error(data.error || 'MSP_ERROR');
  if (command === 'INFO' && (data.firmware !== 'jugend-msp-reader' || data.version !== '0.2.0')) throw new Error('Falsche ESP32-Firmware');
  if (command === 'FCINFO' && (data.ok !== true || data.variant !== 'BTFL' || !/^\d+\.\d+\.\d+$/.test(data.version))) throw new Error('Ungültige FC-Identität');
  if (command === 'ATTITUDE') {
    if (data.ok !== true || !['roll_deg','pitch_deg','yaw_deg'].every(k => typeof data[k] === 'number' && Number.isFinite(data[k])) || !/^[a-f0-9]{12}$/i.test(data.payload_hex)) throw new Error('Ungültige Lage-Daten');
    const values = data.payload_hex.match(/.{4}/g).map(hex => {
      let value = parseInt(hex.slice(2) + hex.slice(0,2),16);
      return value >= 32768 ? value - 65536 : value;
    });
    if (values[0]/10 !== data.roll_deg || values[1]/10 !== data.pitch_deg || values[2] !== data.yaw_deg) throw new Error('MSP-Payload stimmt nicht mit Winkeln überein');
  }
  return data;
}

export function hardwareStatus(sample, connected, consent, now = Date.now()) {
  if (!consent) return { available:false, reason:'Keine Freigabe für OpenAI' };
  if (!connected || !sample || now - sample.received_ms > 5000 || now < sample.received_ms) return { available:false, reason:'Nicht verbunden oder Messung älter als 5 Sekunden' };
  return { available:true, source:'ESP32 UART MSP 108', read_only:true, received_at:sample.received_at,
    age_ms:now-sample.received_ms, roll_deg:sample.data.roll_deg, pitch_deg:sample.data.pitch_deg, yaw_deg:sample.data.yaw_deg };
}

export class MSPSerial {
  constructor(onDisconnect = () => {}) { this.onDisconnect = onDisconnect; }
  async connect(port) {
    if (this.port || this.closing) throw new Error('Verbindung läuft bereits');
    this.port = port;
    try {
      await port.open({baudRate:115200});
      this.reader = port.readable.getReader();
      this.writer = port.writable.getWriter();
      this.loop = this.readLoop();
      this.identity = await this.query('INFO');
      this.fc = await this.query('FCINFO');
      this.ready = true;
      return {esp:this.identity.data, fc:this.fc.data};
    } catch (error) { await this.close(); throw error; }
  }
  async query(command) {
    if (!['INFO','FCINFO','ATTITUDE'].includes(command)) throw new Error('Befehl nicht erlaubt');
    if (!this.writer || this.closing) throw new Error('Nicht verbunden');
    if (this.pending) throw new Error('Abfrage läuft bereits');
    const started = performance.now();
    const line = await new Promise((resolve,reject) => {
      const timer = setTimeout(() => {
        this.pending = null; reject(new Error('USB_TIMEOUT · Bitte neu verbinden'));
        void this.close(); // Late replies must not be mistaken for the next request.
      },2500);
      this.pending = {resolve,reject,timer};
      this.writer.write(new TextEncoder().encode(command+'\n')).catch(error => {
        this.fail(error); void this.close();
      });
    });
    return {command, raw:line, data:decodeReply(command,line), received_ms:Date.now(), received_at:new Date().toISOString(), round_trip_ms:Math.round((performance.now()-started)*100)/100};
  }
  fail(error) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null;
  }
  async readLoop() {
    let buffer = ''; const decoder = new TextDecoder();
    try {
      while (true) {
        const {value,done} = await this.reader.read();
        if (done) break;
        buffer += decoder.decode(value,{stream:true});
        if (buffer.length > 4096) throw new Error('USB-Antwort zu lang');
        let index;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0,index).trim(); buffer = buffer.slice(index+1);
          if (line && this.pending) {
            const pending = this.pending; this.pending = null;
            clearTimeout(pending.timer); pending.resolve(line);
          }
        }
      }
    } catch(error) { this.fail(error); }
    finally {
      this.reader.releaseLock(); this.reader = null;
      this.fail(new Error('USB-Verbindung beendet'));
      if (!this.closing) { this.ready = false; queueMicrotask(() => void this.close()); }
    }
  }
  close() {
    if (this.closing) return this.closing;
    this.ready = false;
    this.closing = (async () => {
      this.fail(new Error('USB getrennt'));
      try { await this.reader?.cancel(); } catch {}
      await this.loop;
      this.writer?.releaseLock(); this.writer = null;
      try { await this.port?.close(); } catch {}
      this.port = null; this.loop = null;
      this.onDisconnect();
    })().finally(() => { this.closing = null; });
    return this.closing;
  }
}
