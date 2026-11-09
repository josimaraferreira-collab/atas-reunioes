// Funções sem dependências externas (testáveis sem instalar nada).
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v) => typeof v === 'string' && uuid.test(v);

// Tipos de áudio aceitos (iPhone grava audio/mp4; Chrome/Android grava webm).
export function mimeAudio(valor) {
  const base = String(valor || '').split(';')[0].trim().toLowerCase();
  return ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'].includes(base) ? base : null;
}

// Responde um pedaço do áudio (Range), necessário para o Safari tocar o áudio.
export function faixaBytes(cabecalho, total) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(cabecalho || '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let inicio, fim;
  if (!m[1]) { inicio = Math.max(0, total - Number(m[2])); fim = total - 1; }
  else { inicio = Number(m[1]); fim = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1; }
  if (inicio > fim || inicio >= total) return 'invalida';
  return {inicio, fim};
}
