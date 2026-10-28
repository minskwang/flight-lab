export function createSimulator() {
  let state;
  const reset = () => { state = { simulation_only: true, mode: 'grounded', battery_percent: 100, position: { forward: 0, right: 0, vertical: 0 }, yaw_degrees: 0, last_command: null }; };
  reset();
  const snapshot = () => structuredClone(state);
  function execute(name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args)) return { ok: false, error: 'Die Parameter müssen ein Objekt sein', state: snapshot() };
    const fail = error => ({ ok: false, error, state: snapshot() });
    if (name === 'get_drone_status') return Object.keys(args).length ? fail('Unerwartete Parameter') : { ok: true, state: snapshot() };
    if (name === 'flight_action') {
      if (Object.keys(args).length !== 1 || !['takeoff','land','hover','emergency_stop','reset'].includes(args.action)) return fail('Ungültige Aktion');
      if (args.action === 'reset') reset();
      else if (args.action === 'emergency_stop') state.mode = 'emergency_stopped';
      else if (state.mode === 'emergency_stopped') return fail('Not-Stopp ist aktiv. Ein ausdrückliches Zurücksetzen ist erforderlich.');
      else if (args.action === 'takeoff') { state.mode = 'airborne'; state.position.vertical = Math.max(1, state.position.vertical); }
      else if (args.action === 'land') { state.mode = 'grounded'; state.position.vertical = 0; }
      else if (state.mode === 'airborne') state.last_command = { forward: 0, right: 0, vertical: 0, yaw: 0, duration_ms: 0 };
      return { ok: true, state: snapshot() };
    }
    if (name !== 'move_drone') return fail('Unbekanntes Werkzeug');
    const axes = ['forward','right','vertical','yaw'];
    if (Object.keys(args).length !== 5 || axes.some(k => typeof args[k] !== 'number' || !Number.isFinite(args[k]) || Math.abs(args[k]) > 1) || !Number.isInteger(args.duration_ms) || args.duration_ms < 100 || args.duration_ms > 2000) return fail('Ungültige Bewegung. Achsen: −1 bis 1; duration_ms: ganze Zahl von 100 bis 2000.');
    if (state.mode !== 'airborne') return fail('Die Drohne ist nicht in der Luft. Zuerst ausdrücklich starten; nach einem Not-Stopp zuerst zurücksetzen.');
    const dt = args.duration_ms / 1000;
    // Illustrative fixed-frame displacement, not a physical flight model.
    for (const key of ['forward','right','vertical']) state.position[key] = Math.round((state.position[key] + args[key] * dt) * 1000) / 1000;
    state.position.vertical = Math.max(0, state.position.vertical);
    state.yaw_degrees = Math.round((state.yaw_degrees + args.yaw * 90 * dt) * 100) / 100;
    state.last_command = { ...args };
    return { ok: true, state: snapshot() };
  }
  return { execute, snapshot, reset };
}

// Consume only completed responses; reject partial/cancelled actions and deduplicate IDs.
export function processResponse(event, simulator, seen, send, record) {
  if (event.type !== 'response.done') return;
  let count = 0;
  for (const item of event.response?.output || []) {
    if (item.type !== 'function_call' || !item.call_id || seen.has(item.call_id)) continue;
    seen.add(item.call_id);
    let args, result;
    try {
      args = JSON.parse(item.arguments);
      result = event.response.status === 'completed' ? simulator.execute(item.name, args) : { ok: false, error: 'Antwort abgebrochen oder unvollständig; Aktion nicht ausgeführt' };
    } catch { result = { ok: false, error: 'Ungültige JSON-Parameter' }; }
    record({ call_id: item.call_id, name: item.name, arguments: args ?? item.arguments, result });
    send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(result) } });
    count++;
  }
  if (count && event.response.status === 'completed') send({ type: 'response.create' });
}
