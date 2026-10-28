import test from 'node:test';
import assert from 'node:assert/strict';
import { MSPSerial, decodeReply, hardwareStatus } from './public/serial.mjs';
import {createSimulator,processResponse} from './public/simulator.mjs';
const attitude = {ok:true,roll_deg:-83.4,pitch_deg:5.1,yaw_deg:3,payload_hex:'befc33000300'};
function portFor(reply) {
  let controller; const writes=[];
  return {writes, async open() {
    this.readable=new ReadableStream({start(c){controller=c;}});
    this.writable=new WritableStream({write(bytes){
      const command=new TextDecoder().decode(bytes).trim(); writes.push(command);
      const text=reply(command); if(text!==undefined) {
        const data=new TextEncoder().encode(text+'\r\n');
        controller.enqueue(data.slice(0,3)); controller.enqueue(data.slice(3));
      }
    }});
  }, async close(){this.closed=true;}};
}
function answer(command) {
  return JSON.stringify(command==='INFO'?{firmware:'jugend-msp-reader',version:'0.2.0'}:command==='FCINFO'?{ok:true,variant:'BTFL',version:'4.5.1'}:attitude);
}
test('fragmented serial replies, identity, attitude and allowlist',async()=>{
 const port=portFor(answer), serial=new MSPSerial();
 await serial.connect(port); assert.equal(serial.ready,true);
 assert.deepEqual((await serial.query('ATTITUDE')).data,attitude);
 await assert.rejects(serial.query('ARM'),/nicht erlaubt/);
 assert.deepEqual(port.writes,['INFO','FCINFO','ATTITUDE']);
 await serial.close(); assert.equal(serial.ready,false); assert.equal(port.closed,true);
});
test('wrong firmware closes port',async()=>{
 const port=portFor(()=>'{"firmware":"other"}'), serial=new MSPSerial();
 await assert.rejects(serial.connect(port),/Firmware/); assert.equal(port.closed,true);
});
test('timeout disconnects to prevent reuse of late responses',async()=>{
 const port=portFor(c=>c==='ATTITUDE'?undefined:answer(c)), serial=new MSPSerial();
 await serial.connect(port); await assert.rejects(serial.query('ATTITUDE'),/USB_TIMEOUT/);
 await serial.close(); assert.equal(port.closed,true); assert.equal(serial.ready,false);
});
test('payload mismatch, errors and malformed replies are rejected',()=>{
 assert.throws(()=>decodeReply('ATTITUDE',JSON.stringify({...attitude,roll_deg:1})),/Payload/);
 assert.throws(()=>decodeReply('ATTITUDE','{"ok":false,"error":"MSP_TIMEOUT"}'),/MSP_TIMEOUT/);
 assert.throws(()=>decodeReply('ATTITUDE','{}'),/Ungültige/);
});
test('privacy, disconnect and stale samples prevent hardware disclosure',()=>{
 const sample={data:attitude,received_ms:1000,received_at:'test'};
 for(const [connected,consent,now] of [[true,false,1100],[false,true,1100],[true,true,6001]]) {
  const value=hardwareStatus(sample,connected,consent,now);
  assert.equal(value.available,false); assert.equal(value.roll_deg,undefined);
 }
 assert.equal(hardwareStatus(sample,true,true,1100).roll_deg,-83.4);
});
test('tool results preserve simulation and send permitted hardware; duplicate and cancelled calls do not execute',()=>{
 const simulator=createSimulator(),seen=new Set(),events=[];let executions=0;
 const executor={execute(name,args){executions++;const result=simulator.execute(name,args);result.hardware=hardwareStatus({data:attitude,received_ms:Date.now()},true,true);return result;}};
 const event={type:'response.done',response:{status:'completed',output:[{type:'function_call',call_id:'one',name:'get_drone_status',arguments:'{}'}]}};
 processResponse(event,executor,seen,e=>events.push(e),()=>{});
 const output=JSON.parse(events[0].item.output);
 assert.equal(output.state.simulation_only,true);assert.equal(output.hardware.roll_deg,-83.4);
 processResponse(event,executor,seen,()=>{},()=>{});assert.equal(executions,1);
 event.response.status='cancelled';event.response.output[0].call_id='two';
 processResponse(event,executor,seen,()=>{},()=>{});assert.equal(executions,1);
});
