// Chat with the qualification agent in your terminal. No WhatsApp account needed.
//   npm run simulate

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { handleMessage, initialState } from './agent.ts';
import { proposeSlots } from './booking.ts';

const rl = createInterface({ input: stdin, output: stdout });
let state = initialState();
console.log('LEAD-GEN agent simulator. You are the homeowner. Type a first message (e.g. "Hi, I saw your ad"). Ctrl+C to quit.\n');

for (;;) {
  const text = await rl.question('you> ');
  const r = handleMessage(state, text, { now: new Date(), proposeSlots: (d) => proposeSlots(d) });
  state = r.state;
  for (const m of r.replies) console.log(`\nbot> ${m.replace(/\n/g, '\n     ')}\n`);
  const meta = r.events.filter((e) => e.type !== 'status').map((e) => JSON.stringify(e).slice(0, 120));
  if (meta.length) console.log(`     [events] ${meta.join(' | ')}\n`);
  console.log(`     [stage=${state.stage}${state.score !== undefined ? ` score=${state.score}` : ''}]\n`);
}
