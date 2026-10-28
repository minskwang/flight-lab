const axis = (description) => ({ type: 'number', minimum: -1, maximum: 1, description });
export const tools = [
  { type: 'function', name: 'move_drone', description: 'Apply one short movement to the SIMULATED drone. Values are normalized intent, not meters or real flight control.', parameters: {
    type: 'object', additionalProperties: false,
    properties: { forward: axis('Positive forward, negative backward'), right: axis('Positive right, negative left'), vertical: axis('Positive up, negative down'), yaw: axis('Positive clockwise/right turn, negative left turn'), duration_ms: { type: 'integer', minimum: 100, maximum: 2000 } },
    required: ['forward', 'right', 'vertical', 'yaw', 'duration_ms']
  } },
  { type: 'function', name: 'flight_action', description: 'Change simulated flight mode. emergency_stop latches the simulator until reset.', parameters: {
    type: 'object', additionalProperties: false, properties: { action: { type: 'string', enum: ['takeoff', 'land', 'hover', 'emergency_stop', 'reset'] } }, required: ['action']
  } },
  { type: 'function', name: 'get_drone_status', description: 'Read simulated state plus optional read-only hardware attitude, when the user permits sharing and the sample is fresh.', parameters: { type: 'object', properties: {}, additionalProperties: false, required: [] } }
];
export function sessionConfig(model = 'gpt-realtime-2.1') {
  return {
    type: 'realtime', model, output_modalities: ['text'], max_output_tokens: 600,
    audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 650, create_response: true, interrupt_response: true } } },
    tools, tool_choice: 'auto',
    instructions: `You are a multilingual voice interface for a SIMULATED drone, with optional read-only ESP32 attitude telemetry. All movement commands remain simulation-only. get_drone_status may include a separate hardware field with real roll/pitch/yaw and timestamp. Report hardware angles only when hardware.available is true. Never infer real position, altitude, battery, flight readiness or motor state from attitude. When hardware is unavailable, say so and ask the user to read a new sample or grant sharing. Keep simulated state and measured attitude clearly distinct. Understand freely spoken Chinese, German and English, including mixed languages. The interface is German. Reply briefly in German by default, even when the input is in another language, unless the user explicitly asks for a different reply language. For an unambiguous flight intent, ALWAYS call the appropriate tool, rather than only describing JSON. For status questions call get_drone_status. Do not call tools for quoted examples, negations, background speech or ordinary conversation. Ask one short question if direction or intent is unclear. Never claim hardware was moved.
Movement axes: forward positive=forward, right positive=right, vertical positive=up, yaw positive=clockwise/right. Negative values are opposites. Unspecified axes=0. Gentle/a little/ein bisschen/一点 uses magnitude 0.2 and 350ms; normal unspecified movement uses 0.4 and 600ms. duration_ms is 100..2000. For diagonals set both axes. These are normalized intent values, not distance estimates. Do not invent precise meters. Do not execute indefinite movement or long action sequences. A request to stop means hover; emergency stop means emergency_stop. A stopped simulator requires explicit reset; never reset automatically. Simulator begins grounded. If move_drone reports not airborne, ask user to say takeoff; do not silently take off. Only explicit takeoff authorizes takeoff. Use tool results as truth. After successful tool execution, acknowledge in one short sentence and do not repeat that tool call. Tool results may say simulation_only; all actions are simulation only.`
  };
}
