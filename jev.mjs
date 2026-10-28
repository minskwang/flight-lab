// Official HTTP contract: https://docs.typesafe.ai/api
const choice = (instructions, criteria) => ({ type: 'choice', instructions, criteria });
const axis = (positive, negative) => choice(`Which ${positive}/${negative} movement is explicitly requested? Unmentioned axes are zero. Read German, English or Chinese.`, { positive, negative, zero: 'No movement on this axis' });
export const questions = {
  intent: choice('Identify the single immediate drone instruction in text. Respect negation. Questions about capabilities, hypothetical commands, ambiguous instructions, unsupported precise distances and multi-step sequences must be unclear. Never infer takeoff from a movement request.', {
    takeoff: 'Explicitly take off', land: 'Land now', hover: 'Hold still / hover', emergency_stop: 'Emergency motor stop', reset: 'Explicitly reset simulator', status: 'Read current drone status', move: 'One movement, possibly diagonal or including rotation', unclear: 'No single supported clear command'
  }),
  forward: axis('forward', 'backward'), right: axis('right', 'left'), vertical: axis('up', 'down'), yaw: axis('clockwise yaw', 'counterclockwise yaw'),
  strength: choice('How strong is the requested movement? Use normal if unspecified.', { gentle: 'Slightly / a little / gently', normal: 'Normal or unspecified', strong: 'Strong or fast' }),
  duration: choice('Choose the requested duration. Use brief for a little/slightly, otherwise normal if unspecified. Explicit times outside these choices are unsupported.', { brief: '350 milliseconds / brief', normal: '600 milliseconds / unspecified', second: '1 second / 1000 milliseconds', two_seconds: '2 seconds / 2000 milliseconds', unsupported: 'Another explicit duration' })
};
export function decodeDecision(data) {
  const answers = data?.answers;
  const used = [];
  function select(id) {
    const a = answers?.[id];
    if (a?.type !== 'choice' || !Object.hasOwn(questions[id].criteria, a.choice) || !Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1) throw new Error('Ungültige Jev-Antwort');
    const p = a.probabilities;
    const keys = Object.keys(questions[id].criteria);
    if (!p || keys.some(k => !Number.isFinite(p[k]) || p[k] < 0 || p[k] > 1) || Math.abs(keys.reduce((s,k) => s+p[k],0)-1) > 0.02 || p[a.choice] < Math.max(...keys.map(k=>p[k]))-0.001) throw new Error('Ungültige Jev-Wahrscheinlichkeiten');
    used.push({ question: id, choice: a.choice, confidence: a.confidence, probability: p[a.choice] });
    return a.choice;
  }
  const intent = select('intent');
  let command = null;
  let reason = 'Bitte formuliere genau einen eindeutigen Flugwunsch.';
  if (intent === 'status') command = { name: 'get_drone_status', arguments: {} };
  else if (['takeoff','land','hover','emergency_stop','reset'].includes(intent)) command = { name: 'flight_action', arguments: { action: intent } };
  else if (intent === 'move') {
    const signs = { positive: 1, negative: -1, zero: 0 };
    const args = Object.fromEntries(['forward','right','vertical','yaw'].map(k => [k, signs[select(k)]]));
    const strength = { gentle: 0.2, normal: 0.4, strong: 0.6 }[select('strength')];
    const duration = select('duration');
    const duration_ms = { brief: 350, normal: 600, second: 1000, two_seconds: 2000 }[duration];
    if (duration_ms && Object.values(args).some(Boolean)) command = { name: 'move_drone', arguments: { ...Object.fromEntries(Object.entries(args).map(([k,v])=>[k,v*strength])), duration_ms } };
    else reason = 'Bitte nenne eine Richtung und eine Dauer von 350, 600, 1000 oder 2000 ms.';
  }
  if (used.some(a => a.confidence < 0.75 || a.probability < 0.8)) { command = null; reason = 'Jev ist unsicher. Keine Aktion ausgeführt; bitte genauer formulieren.'; }
  return { command, reason: command ? null : reason, decisions: used, model: typeof data.model === 'string' ? data.model : 'jev-latest' };
}
export async function decide(text, state, key, fetcher = fetch) {
  const response = await fetcher('https://api.typesafe.ai/v1/systemone', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: process.env.TYPESAFE_MODEL || 'jev-latest', state: { text, drone: state, simulation_only: true }, questions }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(response.status === 401 ? 'TypeSafe-Schlüssel ungültig. Bitte neu einrichten.' : response.status === 429 ? 'TypeSafe-Limit erreicht. Bitte später erneut versuchen.' : `TypeSafe-Anfrage fehlgeschlagen (HTTP ${response.status}). Prüfe Zugang und Guthaben.`);
  return decodeDecision(await response.json());
}
