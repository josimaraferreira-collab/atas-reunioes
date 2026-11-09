import test from 'node:test';
import assert from 'node:assert/strict';
import {criarGemini, ajustarTempos, mimeGemini, ErroTemporario, limparMarkdown} from '../server/gemini.js';

const resposta = (status, corpo) => ({ok: status < 300, status, text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo))});
const ok = (texto) => resposta(200, {candidates: [{content: {parts: [{text: texto}]}}]});

test('tempos do trecho viram tempo real da reunião', () => {
  assert.equal(ajustarTempos('[00:05] Ana: oi\n[09:59] Beto: tchau', 600), '[10:05] Ana: oi\n[19:59] Beto: tchau');
  assert.equal(ajustarTempos('[59:30] X: y', 3600), '[1:59:30] X: y');
});

test('tipo de áudio para o Gemini', () => {
  assert.equal(mimeGemini('audio/mp4'), 'audio/m4a');
  assert.equal(mimeGemini('audio/webm;codecs=opus'), 'audio/webm');
});

test('limpa cercas de código da ata', () => {
  assert.equal(limparMarkdown('```markdown\n# Ata\n```'), '# Ata');
});

test('transcreve e ajusta tempos', async () => {
  const chamadas = [];
  const g = criarGemini({chave: 'k', fetchFn: async (url, op) => { chamadas.push({url, corpo: JSON.parse(op.body)}); return ok('[00:10] Ana: bom dia'); }, espera: async () => {}});
  const t = await g.transcrever({audio: Buffer.from('abc'), mime: 'audio/mp4', reuniao: {titulo: 'Teste', participantes: 'Ana'}, contexto: '', offset: 600});
  assert.equal(t, '[10:10] Ana: bom dia');
  assert.match(chamadas[0].url, /gemini-3\.8-flash:generateContent$/);
  assert.equal(chamadas[0].corpo.contents[0].parts[1].inline_data.mime_type, 'audio/m4a');
  assert.equal(chamadas[0].corpo.contents[0].parts[1].inline_data.data, Buffer.from('abc').toString('base64'));
});

test('modelo sobrecarregado: tenta o próximo', async () => {
  const urls = [];
  const g = criarGemini({chave: 'k', fetchFn: async (url) => { urls.push(url); return urls.length === 1 ? resposta(503, 'overloaded') : ok('# Ata'); }, espera: async () => {}});
  assert.equal(await g.redigirAta({reuniao: {titulo: 'T', data_reuniao: new Date().toISOString(), duracao_seg: 60}, transcricao: 'x'}), '# Ata');
  assert.equal(urls.length, 2);
});

test('todos sobrecarregados: erro temporário', async () => {
  const g = criarGemini({chave: 'k', fetchFn: async () => resposta(503, 'overloaded'), espera: async () => {}});
  await assert.rejects(g.redigirAta({reuniao: {titulo: 'T', data_reuniao: new Date().toISOString()}, transcricao: 'x'}), ErroTemporario);
});

test('chave recusada: erro claro', async () => {
  const g = criarGemini({chave: 'k', fetchFn: async () => resposta(400, 'API key not valid. API_KEY_INVALID'), espera: async () => {}});
  await assert.rejects(g.redigirAta({reuniao: {titulo: 'T', data_reuniao: new Date().toISOString()}, transcricao: 'x'}), /chave do Gemini foi recusada/);
});

test('sem chave configurada', async () => {
  const g = criarGemini({chave: '', fetchFn: async () => ok('x')});
  await assert.rejects(g.redigirAta({reuniao: {titulo: 'T', data_reuniao: new Date().toISOString()}, transcricao: 'x'}), /GEMINI_API_KEY/);
});
