import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstallerCommand } from '../src/db/ops.ts';
import { ClaudeInterpreter, specFor } from '../src/llm.ts';
import { signPaystack, verifyPaystackSignature } from '../src/paystack.ts';
import { water } from '../src/playbooks/water.ts';
import { renderTemplate, TEMPLATES } from '../src/templates.ts';
import { insideServiceWindow } from '../src/whatsapp.ts';

test('installer command parser', () => {
  assert.deepEqual(parseInstallerCommand('WON 7kq2m 16 500'), { cmd: 'won', ref: '7KQ2M', amount: 16500 });
  assert.deepEqual(parseInstallerCommand('won 7KQ2M R16,500'), { cmd: 'won', ref: '7KQ2M', amount: 16500 });
  assert.deepEqual(parseInstallerCommand('WON 7KQ2M'), { cmd: 'won', ref: '7KQ2M', amount: undefined });
  assert.deepEqual(parseInstallerCommand('lost 7KQ2M too expensive'), { cmd: 'lost', ref: '7KQ2M', reason: 'too expensive' });
  assert.deepEqual(parseInstallerCommand('NO SHOW 7KQ2M'), { cmd: 'noshow', ref: '7KQ2M' });
  assert.deepEqual(parseInstallerCommand('noshow 7kq2m'), { cmd: 'noshow', ref: '7KQ2M' });
  assert.deepEqual(parseInstallerCommand('TOPUP 5000'), { cmd: 'topup', amount: 5000 });
  assert.deepEqual(parseInstallerCommand('top up'), { cmd: 'topup', amount: undefined });
  assert.deepEqual(parseInstallerCommand('Balance?'), { cmd: 'balance' });
  assert.deepEqual(parseInstallerCommand('hello'), { cmd: 'help' });
});

test('Paystack signature: HMAC-SHA512 of raw body', () => {
  const raw = Buffer.from('{"event":"charge.success"}');
  assert.equal(verifyPaystackSignature(raw, signPaystack(raw, 'sk_test'), 'sk_test'), true);
  assert.equal(verifyPaystackSignature(raw, signPaystack(raw, 'other'), 'sk_test'), false);
  assert.equal(verifyPaystackSignature(raw, undefined, 'sk_test'), false);
  assert.equal(verifyPaystackSignature(raw, 'zz', 'sk_test'), false);
});

test('templates render with positional params; every template has a Meta-safe name', () => {
  assert.equal(
    renderTemplate('attendance_check', ['AquaSafe Plumbing']),
    'Did AquaSafe Plumbing arrive for your site visit? Reply 1 for Yes or 2 for No.',
  );
  for (const t of Object.values(TEMPLATES)) assert.match(t.name, /^[a-z0-9_]{1,512}$/);
});

test('WhatsApp 24h customer service window', () => {
  const now = new Date('2026-11-09T10:00:00Z');
  assert.equal(insideServiceWindow(new Date('2026-11-09T09:00:00Z'), now), true);
  assert.equal(insideServiceWindow(new Date('2026-11-08T09:59:00Z'), now), false);
  assert.equal(insideServiceWindow(null, now), false);
});

test('LLM specs constrain output to the question', () => {
  const property = specFor(water.questions[0])!;
  assert.deepEqual((property.schema as any).properties.choice.enum, [0, 1, 2, 3, 4]);
  assert.equal(property.toCanonical({ choice: 3 }), '3');
  assert.equal(property.toCanonical({ choice: 0 }), null);
  assert.equal(property.toCanonical({ choice: 9 }), null);
  const suburb = specFor(water.questions[1])!;
  assert.ok((suburb.schema as any).properties.place.enum.includes('other'));
  assert.equal(suburb.toCanonical({ place: 'Ferndale' }), 'Ferndale');
  assert.equal(suburb.toCanonical({ place: 'unclear' }), null);
});

function fakeClient(reply: any) {
  const calls: any[] = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params: any) => {
          calls.push(params);
          return reply;
        },
      },
    },
  };
}

test('ClaudeInterpreter: request shape, canonical answer, usage', async () => {
  const fc = fakeClient({
    model: 'claude-opus-5-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"choice":2}' }],
    usage: { input_tokens: 120, output_tokens: 8 },
  });
  const it = new ClaudeInterpreter(fc as any);
  const r = await it.interpret(water.questions[0], 'we stay in a complex with a body corp');
  assert.deepEqual(r, { canonical: '2', model: 'claude-opus-5-5', tokensIn: 120, tokensOut: 8 });
  const p = fc.calls[0];
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.effort, 'low');
  assert.match(p.messages[0].content, /<reply>\nwe stay in a complex/);
  assert.match(p.system, /untrusted data/);
});

test('ClaudeInterpreter: refusal, bad JSON and missing text all degrade to null', async () => {
  for (const reply of [
    { stop_reason: 'refusal', content: [], usage: {} },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }], usage: {} },
    { stop_reason: 'end_turn', content: [], usage: {} },
  ]) {
    const r = await new ClaudeInterpreter(fakeClient(reply) as any).interpret(water.questions[0], 'x');
    assert.equal(r.canonical, null);
  }
});
