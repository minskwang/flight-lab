import { MSPSerial, hardwareStatus } from './serial.mjs';

export function initHardware() {
  const $ = id => document.getElementById(id);
  let sample = null, busy = false;
  const records = [];
  const append = row => { records.push(row); if (records.length > 10000) records.shift(); };
  const message = text => { $('usbStatus').textContent = text; };
  const clearAngles = () => { for (const id of ['realRoll','realPitch','realYaw']) $(id).textContent = '—'; };
  const serial = new MSPSerial(() => {
    sample = null; clearAngles(); $('shareHardware').checked = false;
    message('USB getrennt · keine aktuellen Messwerte');
    append({event:'disconnect', time:new Date().toISOString()}); update();
  });
  function update() {
    $('usbConnect').disabled = busy || !!serial.port || !navigator.serial;
    $('usbDisconnect').disabled = busy || !serial.port;
    $('usbRead').disabled = busy || !serial.ready;
  }
  async function run(fn) {
    if (busy) return; busy = true; update();
    try { await fn(); }
    catch(error) { sample = null; clearAngles(); message(error.message === 'MSP_TIMEOUT' ? 'ESP32 已响应，但飞控未回应（MSP_TIMEOUT）。请检查飞控 USB 供电及 TX/RX/GND 接线。' : error.name === 'NotFoundError' ? '未选择串口。请再次点击 ESP32 verbinden 并选择 USB JTAG/serial debug unit。' : error.message); append({event:'error',time:new Date().toISOString(),error:error.message}); }
    finally { busy = false; update(); }
  }
  async function read() {
    sample = null; clearAngles();
    const value = await serial.query('ATTITUDE');
    sample = value; append(value);
    $('realRoll').textContent = value.data.roll_deg.toFixed(1);
    $('realPitch').textContent = value.data.pitch_deg.toFixed(1);
    $('realYaw').textContent = value.data.yaw_deg.toFixed(1);
    $('usbTime').textContent = `Einzelmessung: ${value.received_at} · Antwortzeit ${value.round_trip_ms} ms`;
    message('Echte MSP-Lage empfangen · Einzelmessung');
  }
  $('usbConnect').onclick = () => run(async () => {
    message('请选择 ESP32 的 USB 串口…');
    const port = await navigator.serial.requestPort({filters:[{usbVendorId:0x303a,usbProductId:0x1001}]});
    message('正在核对 ESP32 固件和飞控响应…');
    const identity = await serial.connect(port);
    append({event:'connected',time:new Date().toISOString(),...identity});
    message(`ESP32 ${identity.esp.version} · Betaflight ${identity.fc.version}`);
    await read();
  });
  $('usbRead').onclick = () => run(read);
  $('usbDisconnect').onclick = () => run(() => serial.close());
  $('usbExport').onclick = () => {
    const blob = new Blob([JSON.stringify({schema:'flight-lab-hardware-v1',exported_at:new Date().toISOString(),source:'USB ESP32 UART MSP',retention:'last 10000 entries',read_only:true,records},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `flight-lab-hardware-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  };
  window.addEventListener('pagehide',() => { void serial.close(); });
  if (!navigator.serial) message('USB benötigt Chrome oder Edge auf HTTPS / localhost.');
  update();
  return { status:() => hardwareStatus(sample,serial.ready,$('shareHardware').checked) };
}
