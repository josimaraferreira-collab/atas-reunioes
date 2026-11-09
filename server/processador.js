// Processamento em segundo plano no servidor: transcreve cada trecho assim que chega
// e escreve a ata quando a gravação termina. Não depende do celular ficar aberto.
import {ErroTemporario} from './gemini.js';

export function criarProcessador({repo, gemini, espera = (ms) => new Promise((r) => setTimeout(r, ms)), esperaTemporario = 30000, tentativasTemporario = 6, log = console}) {
  const rodando = new Map(); // reuniaoId -> {denovo:boolean}

  async function transcreverTrecho(segId) {
    for (let tentativa = 1; ; tentativa++) {
      const seg = await repo.pegarTrecho(segId);
      if (!seg) return;
      const reuniaoId = String(seg.reuniao_id).toLowerCase();
      try {
        const audio = seg.audio_data;
        if (!audio || audio.length < 2000) { await repo.concluirTrecho(segId, {status: 'ok', transcricao: ''}); return; }
        if (audio.length > 18 * 1024 * 1024) throw new Error('Trecho de áudio grande demais (limite de 18 MB).');
        const reuniao = await repo.reuniaoInterna(reuniaoId);
        const segs = await repo.statusSegmentos(reuniaoId);
        const anterior = segs.find((s) => s.ordem === seg.ordem - 1);
        const offset = segs.filter((s) => s.ordem < seg.ordem).reduce((t, s) => t + (s.duracao_seg || 0), 0);
        const transcricao = await gemini.transcrever({audio, mime: seg.mime, reuniao, contexto: anterior?.transcricao ? anterior.transcricao.slice(-1500) : '', offset});
        await repo.concluirTrecho(segId, {status: 'ok', transcricao});
        return;
      } catch (e) {
        if (e instanceof ErroTemporario && tentativa < tentativasTemporario) {
          await repo.concluirTrecho(segId, {status: 'pendente'});
          log.warn?.('gemini_ocupado_trecho', segId, tentativa);
          await espera(esperaTemporario);
          continue;
        }
        const msg = e instanceof ErroTemporario ? 'O Gemini ficou sobrecarregado por muito tempo. Toque em Tentar de novo.' : (e?.message || String(e));
        await repo.concluirTrecho(segId, {status: 'erro', erro: msg});
        return;
      }
    }
  }

  async function escreverAta(reuniaoId) {
    const reuniao = await repo.reuniaoInterna(reuniaoId);
    const segs = await repo.statusSegmentos(reuniaoId);
    const transcricao = segs.map((s) => s.transcricao || '').join('\n').trim();
    if (!transcricao) { await repo.statusReuniao(reuniaoId, 'erro', {erro: 'Não foi possível ouvir falas no áudio.'}); return; }
    await repo.statusReuniao(reuniaoId, 'gerando_ata');
    for (let tentativa = 1; ; tentativa++) {
      try {
        const ata = await gemini.redigirAta({reuniao, transcricao});
        await repo.statusReuniao(reuniaoId, 'pronta', {ata});
        return;
      } catch (e) {
        if (e instanceof ErroTemporario && tentativa < tentativasTemporario) { await espera(esperaTemporario); continue; }
        const msg = e instanceof ErroTemporario ? 'O Gemini estava sobrecarregado. Toque em Tentar de novo daqui a pouco.' : (e?.message || String(e));
        await repo.statusReuniao(reuniaoId, 'erro', {erro: msg});
        return;
      }
    }
  }

  async function processar(reuniaoId) {
    do {
      rodando.get(reuniaoId).denovo = false;
      let segs = await repo.statusSegmentos(reuniaoId);
      for (const s of segs.filter((x) => x.status === 'pendente' || x.status === 'processando')) await transcreverTrecho(s.id);
      const reuniao = await repo.reuniaoInterna(reuniaoId);
      if (!reuniao || !['transcrevendo', 'gerando_ata'].includes(reuniao.status)) continue; // ainda gravando: a ata sai depois
      segs = await repo.statusSegmentos(reuniaoId);
      if (segs.some((s) => s.status === 'pendente' || s.status === 'processando')) { rodando.get(reuniaoId).denovo = true; continue; }
      if (!segs.length) { await repo.statusReuniao(reuniaoId, 'erro', {erro: 'Esta reunião não tem áudio.'}); continue; }
      if (segs.some((s) => s.status === 'erro')) { await repo.statusReuniao(reuniaoId, 'erro', {erro: 'Algum trecho não foi transcrito.'}); continue; }
      await escreverAta(reuniaoId);
    } while (rodando.get(reuniaoId).denovo);
  }

  function agendar(reuniaoId) {
    reuniaoId = String(reuniaoId).toLowerCase();
    if (rodando.has(reuniaoId)) { rodando.get(reuniaoId).denovo = true; return rodando.get(reuniaoId).promessa; }
    const estado = {denovo: false};
    rodando.set(reuniaoId, estado);
    estado.promessa = processar(reuniaoId)
      .catch((e) => log.error?.('processamento_falhou', reuniaoId, e?.code || e?.name || e))
      .finally(() => rodando.delete(reuniaoId));
    return estado.promessa;
  }

  return {
    agendar,
    emAndamento: (id) => rodando.has(String(id).toLowerCase()),
    async retomar() {
      await repo.liberarProcessando();
      const ids = await repo.reunioesPendentes();
      ids.forEach(agendar);
      return ids.length;
    },
  };
}
