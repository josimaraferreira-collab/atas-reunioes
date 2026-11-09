import test from 'node:test';
import assert from 'node:assert/strict';
import {ehUuid, mimeAudio, faixaBytes} from '../server/util.js';

test('uuid', () => {
  assert.ok(ehUuid('0f8fad5b-d9cb-469f-a165-70867728950e'));
  assert.ok(!ehUuid('../etc/passwd'));
  assert.ok(!ehUuid(undefined));
});

test('tipos de áudio aceitos', () => {
  assert.equal(mimeAudio('audio/mp4'), 'audio/mp4');
  assert.equal(mimeAudio('audio/webm;codecs=opus'), 'audio/webm');
  assert.equal(mimeAudio('application/pdf'), null);
  assert.equal(mimeAudio(''), null);
});

test('faixa de bytes para o Safari tocar o áudio', () => {
  assert.equal(faixaBytes(undefined, 100), null);
  assert.deepEqual(faixaBytes('bytes=0-1', 100), {inicio: 0, fim: 1});
  assert.deepEqual(faixaBytes('bytes=10-', 100), {inicio: 10, fim: 99});
  assert.deepEqual(faixaBytes('bytes=-20', 100), {inicio: 80, fim: 99});
  assert.deepEqual(faixaBytes('bytes=50-500', 100), {inicio: 50, fim: 99});
  assert.equal(faixaBytes('bytes=200-300', 100), 'invalida');
  assert.equal(faixaBytes('bytes=abc', 100), null);
});
