import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectIntent,
  inTerritory,
  parseChoice,
  parsePostalCode,
  parseRand,
  parseYesNo,
  PAYMENT_KEYWORDS,
  TIMELINE_KEYWORDS,
} from '../src/parse.ts';

test('parseYesNo', () => {
  for (const t of ['yes', 'Yes!', 'ja', 'Yebo', 'yeah we do', 'I own it', 'we own the house']) assert.equal(parseYesNo(t), true, t);
  for (const t of ['no', 'Nope', 'I rent', 'renting', 'yes but I rent']) assert.equal(parseYesNo(t), false, t);
  for (const t of ['not sure', "don't know", 'what?', '']) assert.equal(parseYesNo(t), null, t);
});

test('parseRand', () => {
  assert.equal(parseRand('R2,500'), 2500);
  assert.equal(parseRand('about 3 000 a month'), 3000);
  assert.equal(parseRand('2.5k'), 2500);
  assert.equal(parseRand('R3k'), 3000);
  assert.equal(parseRand('R4000 pm'), 4000);
  assert.equal(parseRand('3'), null);
  assert.equal(parseRand('no idea'), null);
});

test('postal codes and territory', () => {
  assert.equal(parsePostalCode('it is 0081 Pretoria'), '0081');
  assert.equal(parsePostalCode('somewhere'), null);
  assert.equal(inTerritory('0081'), true);
  assert.equal(inTerritory('2196'), true);
  assert.equal(inTerritory('8001'), false);
});

test('parseChoice numbers and keywords', () => {
  assert.equal(parseChoice('2', 4), 2);
  assert.equal(parseChoice('2) in 1-3 months', 4), 2);
  assert.equal(parseChoice('5', 4), null);
  assert.equal(parseChoice('ASAP please', 4, TIMELINE_KEYWORDS), 1);
  assert.equal(parseChoice('not now, just researching', 4, TIMELINE_KEYWORDS), 4);
  assert.equal(parseChoice('probably finance', 3, PAYMENT_KEYWORDS), 2);
  assert.equal(parseChoice('cash', 3, PAYMENT_KEYWORDS), 1);
  assert.equal(parseChoice('not sure', 3, PAYMENT_KEYWORDS), 3);
});

test('detectIntent', () => {
  assert.equal(detectIntent('STOP'), 'stop');
  assert.equal(detectIntent('unsubscribe'), 'stop');
  assert.equal(detectIntent('delete my data'), 'delete');
  assert.equal(detectIntent('can I talk to a human'), 'human');
  assert.equal(detectIntent('this is a scam'), 'human');
  assert.equal(detectIntent('yes'), null);
});
