import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function mimeGemini(m: string): string {
  const base = (m || "").split(";")[0].trim().toLowerCase();
  if (base === "audio/mp4" || base === "audio/x-m4a") return "audio/m4a";
  if (base === "audio/mpeg") return "audio/mp3";
  return base || "audio/m4a";
}

type Parte = { type: "text"; text: string } | { type: "audio"; data: string; mime_type: string };

function textoDaInteraction(j: any): string {
  if (!j) return "";
  if (typeof j.output_text === "string") return j.output_text;
  if (typeof j.outputText === "string") return j.outputText;
  const out = j.outputs ?? j.output ?? [];
  const arr = Array.isArray(out) ? out : [out];
  return arr
    .filter((o: any) => o && o.type !== "thought" && typeof o.text === "string")
    .map((o: any) => o.text)
    .join("");
}

// Erro temporário (Gemini sobrecarregado / limite): o app espera e tenta de novo sozinho.
// A mensagem contém "Limite de uso" porque é isso que o app reconhece para repetir.
export class ErroTemporario extends Error {}
const MSG_OCUPADO = "Gemini sobrecarregado no momento (Limite de uso temporário). Tentando de novo em 30 s…";

async function chamarGemini(key: string, partes: Parte[]): Promise<string> {
  const preferido = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
  // vários modelos: se um estiver sobrecarregado, tenta o próximo
  const modelos = [...new Set([preferido, "gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"])];
  const parts = partes.map((p) =>
    p.type === "text" ? { text: p.text } : { inline_data: { mime_type: p.mime_type, data: p.data } }
  );
  const corpo = JSON.stringify({ contents: [{ role: "user", parts }] });
  const prazoFinal = Date.now() + 120_000; // a função tem ~150 s; sobra margem para salvar
  const erros: string[] = [];
  let soTemporarios = true;

  for (const model of modelos) {
    const resta = prazoFinal - Date.now();
    if (resta < 15_000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(70_000, resta));
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        { method: "POST", headers: { "x-goog-api-key": key, "Content-Type": "application/json" }, body: corpo, signal: ctrl.signal },
      );
      const t = await r.text();
      if (r.ok) {
        const j = JSON.parse(t);
        const texto = (j.candidates?.[0]?.content?.parts ?? [])
          .filter((p: any) => !p.thought)
          .map((p: any) => p.text ?? "")
          .join("");
        if (texto.trim()) return texto;
        erros.push(`${model}: resposta vazia (${j.candidates?.[0]?.finishReason ?? "?"})`);
        soTemporarios = false;
        continue;
      }
      erros.push(`${model} ${r.status}: ${t.slice(0, 200)}`);
      if (r.status === 400 && /API key|API_KEY/i.test(t)) { soTemporarios = false; break; }
      if (r.status === 401 || r.status === 403) { soTemporarios = false; break; }
      if (r.status === 404) continue; // modelo não existe nesta conta: tenta o próximo
      if (r.status !== 429 && r.status !== 500 && r.status !== 503) soTemporarios = false;
      await new Promise((res) => setTimeout(res, 1500));
    } catch (e) {
      erros.push(`${model}: ${ctrl.signal.aborted ? "demorou demais" : e}`);
    } finally {
      clearTimeout(timer);
    }
  }
  console.error(erros.join("\n"));
  const chaveRuim = erros.some((e) => /(40[013]).*(API key|API_KEY|permission)/i.test(e));
  if (chaveRuim) throw new Error("A chave do Gemini foi recusada. Confira a GEMINI_API_KEY no Supabase.");
  if (soTemporarios) throw new ErroTemporario(MSG_OCUPADO);
  throw new Error("O Gemini não respondeu: " + (erros.at(-1) ?? "erro desconhecido"));
}

function mmss(seg: number) {
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = Math.floor(seg % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// Converte [MM:SS] relativos ao bloco para o tempo real da reunião
function ajustarTempos(texto: string, offset: number) {
  return texto.replace(/\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g, (_, h, m, s) => {
    const t = (Number(h || 0) * 3600) + Number(m) * 60 + Number(s) + offset;
    return `[${mmss(t)}]`;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u } = await sb.auth.getUser(auth.replace(/^Bearer\s+/i, ""));
  if (!u?.user) return json({ erro: "Faça login de novo." }, 401);

  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return json({ erro: "Falta cadastrar a chave GEMINI_API_KEY nos segredos das Edge Functions do Supabase." }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ erro: "Pedido inválido" }, 400); }

  // ---------- TRANSCREVER UM BLOCO ----------
  if (body.acao === "transcrever") {
    const { data: seg, error } = await sb.from("ata_segmentos").select("*").eq("id", body.segmento_id).single();
    if (error || !seg) return json({ erro: "Bloco não encontrado" }, 404);
    if (seg.status === "ok" && !body.forcar) return json({ ok: true, transcricao: seg.transcricao });

    const { data: reu } = await sb.from("ata_reunioes").select("*").eq("id", seg.reuniao_id).single();
    await sb.from("ata_segmentos").update({ status: "processando", erro: null }).eq("id", seg.id);

    try {
      const { data: arq, error: eArq } = await sb.storage.from("ata-audios").download(seg.audio_path);
      if (eArq || !arq) throw new Error("Não consegui baixar o áudio deste bloco.");
      const bytes = new Uint8Array(await arq.arrayBuffer());
      if (bytes.length < 2000) {
        await sb.from("ata_segmentos").update({ status: "ok", transcricao: "" }).eq("id", seg.id);
        return json({ ok: true, transcricao: "" });
      }
      if (bytes.length > 18 * 1024 * 1024) throw new Error("Bloco de áudio grande demais (limite ~18 MB).");

      // final do bloco anterior, para manter os mesmos nomes de quem fala
      let contexto = "";
      if (seg.ordem > 0) {
        const { data: ant } = await sb.from("ata_segmentos").select("transcricao")
          .eq("reuniao_id", seg.reuniao_id).eq("ordem", seg.ordem - 1).maybeSingle();
        if (ant?.transcricao) contexto = ant.transcricao.slice(-1500);
      }

      const prompt = [
        "Você é um transcritor profissional de reuniões em português do Brasil.",
        "Transcreva fielmente TODA a fala deste áudio de uma reunião presencial, sem resumir e sem inventar.",
        "Formato obrigatório, uma fala por linha: [MM:SS] Nome: texto",
        "- MM:SS é o tempo dentro deste áudio.",
        "- Identifique quem fala. Use o nome real se a pessoa for chamada pelo nome ou se apresentar; senão use Participante 1, Participante 2 etc., mantendo sempre o mesmo rótulo para a mesma voz.",
        "- Corrija apenas vícios de linguagem óbvios (éé, hã) e repetições involuntárias; mantenha números, valores, datas e nomes exatamente como ditos.",
        "- Trechos incompreensíveis: [inaudível]. Silêncio longo ou conversa paralela irrelevante: [pausa].",
        "- Responda somente com a transcrição, sem comentários.",
        reu?.participantes ? `Participantes informados: ${reu.participantes}` : "",
        reu?.titulo ? `Assunto da reunião: ${reu.titulo}` : "",
        contexto ? `Final da transcrição do trecho anterior (para manter os mesmos rótulos de quem fala):\n${contexto}` : "",
      ].filter(Boolean).join("\n");

      const texto = await chamarGemini(key, [
        { type: "text", text: prompt },
        { type: "audio", data: encodeBase64(bytes), mime_type: mimeGemini(seg.mime) },
      ]);
      const { data: anteriores } = await sb.from("ata_segmentos").select("duracao_seg")
        .eq("reuniao_id", seg.reuniao_id).lt("ordem", seg.ordem);
      const offset = (anteriores ?? []).reduce((s, a) => s + (a.duracao_seg || 0), 0);
      const final = ajustarTempos(texto.trim(), offset);
      await sb.from("ata_segmentos").update({ status: "ok", transcricao: final, erro: null }).eq("id", seg.id);
      return json({ ok: true, transcricao: final });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // temporário: volta para a fila (o app tenta de novo); definitivo: marca erro
      const temp = e instanceof ErroTemporario;
      await sb.from("ata_segmentos").update({ status: temp ? "pendente" : "erro", erro: temp ? null : msg }).eq("id", seg.id);
      return json({ erro: msg }, temp ? 503 : 502);
    }
  }

  // ---------- GERAR A ATA ----------
  if (body.acao === "ata") {
    const { data: reu, error } = await sb.from("ata_reunioes").select("*").eq("id", body.reuniao_id).single();
    if (error || !reu) return json({ erro: "Reunião não encontrada" }, 404);
    const { data: segs } = await sb.from("ata_segmentos").select("ordem,status,transcricao")
      .eq("reuniao_id", reu.id).order("ordem");
    if (!segs?.length) return json({ erro: "Esta reunião não tem áudio." }, 400);
    const faltam = segs.filter((s) => s.status !== "ok").length;
    if (faltam) return json({ erro: `Ainda faltam ${faltam} trecho(s) para transcrever.` }, 409);

    const transcricao = segs.map((s) => s.transcricao || "").join("\n").trim();
    if (!transcricao) {
      await sb.from("ata_reunioes").update({ status: "erro", erro: "Não foi possível ouvir falas no áudio." }).eq("id", reu.id);
      return json({ erro: "Não foi possível ouvir falas no áudio." }, 422);
    }

    await sb.from("ata_reunioes").update({ status: "gerando_ata", erro: null }).eq("id", reu.id);

    const dataBR = new Date(reu.data_reuniao).toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo", dateStyle: "full", timeStyle: "short",
    });

    const prompt = `Você é secretário(a) responsável por redigir atas de reunião em português do Brasil, com linguagem formal, clara e objetiva, na terceira pessoa e no pretérito.

Com base EXCLUSIVAMENTE na transcrição abaixo, redija a ata da reunião em Markdown, seguindo esta estrutura:

# ATA DA REUNIÃO – ${reu.titulo}

**Data e horário:** ${dataBR}
**Local:** ${reu.local || "(não informado)"}
**Duração aproximada:** ${mmss(reu.duracao_seg || 0)}

## Síntese
(2 ou 3 frases: objetivo da reunião e principal resultado)

## Participantes
(lista; use os nomes informados e os identificados na transcrição; quem não foi identificado aparece como Participante N)

## Pauta
(lista numerada dos assuntos tratados${reu.pauta ? "; considere a pauta prevista informada" : ""})

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

${reu.participantes ? `Participantes informados: ${reu.participantes}\n` : ""}${reu.pauta ? `Pauta prevista: ${reu.pauta}\n` : ""}
TRANSCRIÇÃO:
${transcricao}`;

    try {
      let ata = await chamarGemini(key, [{ type: "text", text: prompt }]);
      ata = ata.trim().replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
      await sb.from("ata_reunioes").update({ status: "pronta", ata, erro: null }).eq("id", reu.id);
      return json({ ok: true, ata });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const final = e instanceof ErroTemporario ? "O Gemini estava sobrecarregado. Toque em Tentar de novo daqui a pouco." : msg;
      await sb.from("ata_reunioes").update({ status: "erro", erro: final }).eq("id", reu.id);
      return json({ erro: final }, 502);
    }
  }

  return json({ erro: "Ação desconhecida" }, 400);
});
