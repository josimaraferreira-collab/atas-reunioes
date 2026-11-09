import test from 'node:test';
import assert from 'node:assert/strict';
import {criarProcessador} from '../server/processador.js';
import {ErroTemporario} from '../server/gemini.js';

// banco em memória que imita o repository.js
function bancoFalso({segs = [], status = 'transcrevendo'} = {}) {
  const reu = {id: 'r1', titulo: 'Teste', status, ata: null, erro: null, data_reuniao: new Date().toISOString(), duracao_seg: 0};
  const s = segs.map((x, i) => ({id: 's' + i, reuniao_id: 'r1', ordem: i, mime: 'audio/mp4', duracao_seg: 600, status: 'pendente', transcricao: null, erro: null, audio_data: Buffer.alloc(5000), ...x}));
  return {
    reu, s,
    async liberarProcessando() { s.forEach((x) => { if (x.status === 'processando') x.status = 'pendente'; }); if (reu.status === 'gerando_ata') reu.status = 'transcrevendo'; },
    async reunioesPendentes() { return ['transcrevendo', 'gerando_ata'].includes(reu.status) || s.some((x) => ['pendente', 'processando'].includes(x.status)) ? ['r1'] : []; },
    async reuniaoInterna() { return {...reu}; },
    async statusSegmentos() { return s.map(({id, ordem, status, duracao_seg, transcricao}) => ({id, ordem, status, duracao_seg, transcricao})); },
    async pegarTrecho(id) { const x = s.find((y) => y.id === id && ['pendente', 'processando'].includes(y.status)); if (!x) return null; x.status = 'processando'; return {...x}; },
    async concluirTrecho(id, {status, transcricao = null, erro = null}) { const x = s.find((y) => y.id === id); x.status = status; if (transcricao !== null) x.transcricao = transcricao; x.erro = erro; },
    async statusReuniao(id, st, {erro = null, ata} = {}) { reu.status = st; reu.erro = erro; if (ata !== undefined) reu.ata = ata; },
  };
}
const geminiFalso = (extra = {}) => ({
  async transcrever({offset}) { return `[00:00 +${offset}] fala`; },
  async redigirAta({transcricao}) { return '# Ata\n' + transcricao; },
  ...extra,
});

test('transcreve todos os trechos em ordem e escreve a ata', async () => {
  const repo = bancoFalso({segs: [{}, {}]});
  const p = criarProcessador({repo, gemini: geminiFalso(), espera: async () => {}});
  await p.agendar('r1');
  assert.deepEqual(repo.s.map((x) => x.status), ['ok', 'ok']);
  assert.equal(repo.s[1].transcricao, '[00:00 +600] fala'); // segundo trecho começa em 10 min
  assert.equal(repo.reu.status, 'pronta');
  assert.match(repo.reu.ata, /^# Ata/);
});

test('enquanto grava, só transcreve (a ata sai ao encerrar)', async () => {
  const repo = bancoFalso({segs: [{}], status: 'gravando'});
  const p = criarProcessador({repo, gemini: geminiFalso(), espera: async () => {}});
  await p.agendar('r1');
  assert.equal(repo.s[0].status, 'ok');
  assert.equal(repo.reu.status, 'gravando');
  assert.equal(repo.reu.ata, null);
});

test('trecho muito curto (silêncio) não chama o Gemini', async () => {
  const repo = bancoFalso({segs: [{audio_data: Buffer.alloc(100)}]});
  let chamou = false;
  const p = criarProcessador({repo, gemini: geminiFalso({async transcrever() { chamou = true; return 'x'; }}), espera: async () => {}});
  await p.agendar('r1');
  assert.equal(chamou, false);
  assert.equal(repo.reu.status, 'erro');
  assert.match(repo.reu.erro, /ouvir falas/);
});

test('Gemini ocupado: espera e tenta de novo sozinho', async () => {
  const repo = bancoFalso({segs: [{}]});
  let vezes = 0;
  const p = criarProcessador({repo, gemini: geminiFalso({async transcrever() { vezes++; if (vezes < 3) throw new ErroTemporario('ocupado'); return 'ok'; }}), espera: async () => {}});
  await p.agendar('r1');
  assert.equal(vezes, 3);
  assert.equal(repo.reu.status, 'pronta');
});

test('erro definitivo num trecho deixa a reunião com erro', async () => {
  const repo = bancoFalso({segs: [{}, {}]});
  const p = criarProcessador({repo, gemini: geminiFalso({async transcrever({offset}) { if (offset) throw new Error('áudio corrompido'); return 'x'; }}), espera: async () => {}});
  await p.agendar('r1');
  assert.equal(repo.s[1].status, 'erro');
  assert.equal(repo.s[1].erro, 'áudio corrompido');
  assert.equal(repo.reu.status, 'erro');
  assert.match(repo.reu.erro, /Algum trecho/);
});

test('ao reiniciar o serviço, retoma o que estava no meio', async () => {
  const repo = bancoFalso({segs: [{status: 'processando'}], status: 'gerando_ata'});
  const p = criarProcessador({repo, gemini: geminiFalso(), espera: async () => {}});
  assert.equal(await p.retomar(), 1);
  while (p.emAndamento('r1')) await new Promise((r) => setTimeout(r, 5));
  assert.equal(repo.reu.status, 'pronta');
});

test('trecho novo chegando durante o processamento também é transcrito', async () => {
  const repo = bancoFalso({segs: [{}], status: 'gravando'});
  let p;
  const g = geminiFalso({async transcrever() {
    if (repo.s.length === 1) { repo.s.push({id: 's1', reuniao_id: 'r1', ordem: 1, mime: 'audio/mp4', duracao_seg: 60, status: 'pendente', transcricao: null, audio_data: Buffer.alloc(5000)}); p.agendar('r1'); }
    return 'x';
  }});
  p = criarProcessador({repo, gemini: g, espera: async () => {}});
  await p.agendar('r1');
  assert.deepEqual(repo.s.map((x) => x.status), ['ok', 'ok']);
});
