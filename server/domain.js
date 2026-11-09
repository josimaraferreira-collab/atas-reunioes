import {z} from 'zod';
import {ehUuid} from './util.js';
export {ehUuid, mimeAudio, faixaBytes} from './util.js';

const opcional = (max) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
export const dadosReuniaoSchema = z.object({
  titulo: z.string().trim().max(200).optional().transform((v) => v || 'Reunião'),
  local: opcional(200),
  participantes: opcional(2000),
  pauta: opcional(4000),
});
export const ataSchema = z.object({ata: z.string().max(400000)});
export const trechoSchema = z.object({
  ordem: z.coerce.number().int().min(0).max(10000),
  duracao: z.coerce.number().min(0).max(4 * 3600).transform(Math.round),
});
export const finalizarSchema = z.object({duracao_seg: z.coerce.number().int().min(0).max(24 * 3600).optional()});

// Usuário Microsoft (Entra ID) da Solven. Se requiredRole estiver configurado, exige a função do app.
export function identityFromClaims(claims, tenant, requiredRole = '') {
  if (!claims || String(claims.tid || '').toLowerCase() !== tenant.toLowerCase() || !ehUuid(claims.oid)) throw Error('Conta fora da organização.');
  const roles = Array.isArray(claims.roles) ? claims.roles : [];
  if (requiredRole && !roles.includes(requiredRole)) throw Error('Conta sem permissão para este aplicativo.');
  return {
    id: claims.tid.toLowerCase() + ':' + claims.oid.toLowerCase(),
    name: String(claims.name || claims.preferred_username || 'Usuário').slice(0, 100),
    email: String(claims.preferred_username || claims.email || '').slice(0, 320),
  };
}
