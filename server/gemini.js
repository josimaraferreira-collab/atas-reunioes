// Chamadas ao Google Gemini: transcrição de cada trecho e redação da ata.

export class ErroTemporario extends Error {}

const MODELOS_PADRAO = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-flash-latest', 'gemini-3.5-flash-lite'];

export function mimeGemini(m) {
  const base = String(m || '').split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4' || base === 'audio/x-m4a') return 'audio/m4a';
  if (base === 'audio/mpeg') return 'audio/mp3';
  return base || 'audio/m4a';
}

export function mmss(seg) {
  seg = Math.max(0, Math.floor(seg || 0));
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// Converte [MM:SS] relativos ao trecho para o tempo real da reunião
export function ajustarTempos(texto, offset) {
  return String(texto).replace(/\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g, (_, h, m, s) => `[${mmss(Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + offset)}]`);
}

export function limparMarkdown(texto) {
  return String(texto).trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/, '').trim();
}

export function textoDaResposta(j) {
  return (j?.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
}

export function criarGemini({chave, modelo, fetchFn = fetch, espera = (ms) => new Promise((r) => setTimeout(r, ms))}) {
  const modelos = [...new Set([modelo, ...MODELOS_PADRAO].filter(Boolean))];

  async function chamar(partes, {prazoMs = 240000} = {}) {
    if (!chave) throw new Error('Falta configurar GEMINI_API_KEY no arquivo .env.producao do servidor.');
    const corpo = JSON.stringify({contents: [{role: 'user', parts: partes}]});
    const prazoFinal = Date.now() + prazoMs;
    const erros = [];
    let soTemporarios = true;
    for (const model of modelos) {
      const resta = prazoFinal - Date.now();
      if (resta < 15000) break;
      try {
        const r = await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: {'x-goog-api-key': chave, 'Content-Type': 'application/json'}, body: corpo,
          signal: AbortSignal.timeout(Math.min(180000, resta)),
        });
        const t = await r.text();
        if (r.ok) {
          const j = JSON.parse(t);
          const texto = textoDaResposta(j);
          if (texto.trim()) return texto;
          erros.push(`${model}: resposta vazia (${j.candidates?.[0]?.finishReason ?? '?'})`);
          soTemporarios = false;
          continue;
        }
        erros.push(`${model} ${r.status}: ${t.slice(0, 200)}`);
        if ((r.status === 400 && /API key|API_KEY/i.test(t)) || r.status === 401 || r.status === 403) { soTemporarios = false; break; }
        if (r.status === 404) continue;
        if (![429, 500, 503].includes(r.status)) soTemporarios = false;
        await espera(1500);
      } catch (e) {
        erros.push(`${model}: ${e?.name === 'TimeoutError' ? 'demorou demais' : (e?.code || e?.message || e)}`);
      }
    }
    console.error('gemini_falhou', erros.join(' | '));
    if (erros.some((e) => /(40[013]).*(API key|API_KEY|permission)/i.test(e))) throw new Error('A chave do Gemini foi recusada. Confira GEMINI_API_KEY no servidor.');
    if (soTemporarios) throw new ErroTemporario('Gemini sobrecarregado no momento. O servidor tenta de novo sozinho.');
    throw new Error('O Gemini não respondeu: ' + (erros.at(-1) ?? 'erro desconhecido'));
  }

  return {
    async transcrever({audio, mime, reuniao, contexto, offset}) {
      const prompt = [
        'Você é um transcritor profissional de reuniões em português do Brasil.',
        'Transcreva fielmente TODA a fala deste áudio de uma reunião presencial, sem resumir e sem inventar.',
        'Formato obrigatório, uma fala por linha: [MM:SS] Nome: texto',
        '- MM:SS é o tempo dentro deste áudio.',
        '- Identifique quem fala. Use o nome real se a pessoa for chamada pelo nome ou se apresentar; senão use Participante 1, Participante 2 etc., mantendo sempre o mesmo rótulo para a mesma voz.',
        '- Corrija apenas vícios de linguagem óbvios (éé, hã) e repetições involuntárias; mantenha números, valores, datas e nomes exatamente como ditos.',
        '- Trechos incompreensíveis: [inaudível]. Silêncio longo ou conversa paralela irrelevante: [pausa].',
        '- Responda somente com a transcrição, sem comentários.',
        reuniao?.participantes ? `Participantes informados: ${reuniao.participantes}` : '',
        reuniao?.titulo ? `Assunto da reunião: ${reuniao.titulo}` : '',
        contexto ? `Final da transcrição do trecho anterior (para manter os mesmos rótulos de quem fala):\n${contexto}` : '',
      ].filter(Boolean).join('\n');
      const texto = await chamar([{text: prompt}, {inline_data: {mime_type: mimeGemini(mime), data: Buffer.from(audio).toString('base64')}}]);
      return ajustarTempos(texto.trim(), offset || 0);
    },

    async redigirAta({reuniao, transcricao}) {
      const dataBR = new Date(reuniao.data_reuniao).toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo', dateStyle: 'full', timeStyle: 'short'});
      const prompt = `Você é secretário(a) responsável por redigir atas de reunião em português do Brasil, com linguagem formal, clara e objetiva, na terceira pessoa e no pretérito.

Com base EXCLUSIVAMENTE na transcrição abaixo, redija a ata da reunião em Markdown, seguindo esta estrutura:

# ATA DA REUNIÃO – ${reuniao.titulo}

**Data e horário:** ${dataBR}
**Local:** ${reuniao.local || '(não informado)'}
**Duração aproximada:** ${mmss(reuniao.duracao_seg || 0)}

## Síntese
(2 ou 3 frases: objetivo da reunião e principal resultado)

## Participantes
(lista; use os nomes informados e os identificados na transcrição; quem não foi identificado aparece como Participante N)

## Pauta
(lista numerada dos assuntos tratados${reuniao.pauta ? '; considere a pauta prevista informada' : ''})

## Discussões
(um subtítulo ### por assunto da pauta, com parágrafos resumindo o que foi apresentado e debatido, quem defendeu o quê, valores, números e datas citados)

## Deliberações
(lista do que foi decidido ou aprovado; se nada foi decidido, escreva "Não houve deliberações.")

## Encaminhamentos
(lista no formato: **Ação** — Responsável: nome — Prazo: data/“não definido”)

## Pendências e ressalvas
(lista de dúvidas que ficaram em aberto, confirmações pendentes ou divergências citadas na reunião; se não houver, escreva "- Nenhuma pendência registrada.")

## Encerramento
(um parágrafo: "Nada mais havendo a tratar, a reunião foi encerrada…" com o horário aproximado de término, se possível calcular)

Regras:
- Não invente fatos, nomes, prazos ou decisões que não estejam na transcrição.
- Não use tabelas.
- Seja fiel, mas resuma: a ata não é a transcrição.
- Responda apenas com a ata em Markdown.

${reuniao.participantes ? `Participantes informados: ${reuniao.participantes}\n` : ''}${reuniao.pauta ? `Pauta prevista: ${reuniao.pauta}\n` : ''}
TRANSCRIÇÃO:
${transcricao}`;
      return limparMarkdown(await chamar([{text: prompt}]));
    },
  };
}
