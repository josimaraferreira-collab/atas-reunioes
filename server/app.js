import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import {rateLimit} from 'express-rate-limit';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {dadosReuniaoSchema, ataSchema, trechoSchema, finalizarSchema, ehUuid, mimeAudio, faixaBytes} from './domain.js';
import {nomeArquivo} from './documentos.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const COOKIE = (production) => (production ? '__Host-atas.sid' : 'atas.sid');

export function createApp({repo, sessions, auth, processador, documentos, origin, basePath = '', production = false, trustProxy = 0}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
      frameAncestors: ["'none'"], formAction: ["'self'"], upgradeInsecureRequests: production ? [] : null,
    }},
    strictTransportSecurity: production ? undefined : false,
  }));
  // o microfone precisa estar liberado para este site
  app.use((_req, res, next) => { res.set('Permissions-Policy', 'microphone=(self), camera=(), geolocation=()'); next(); });

  const router = express.Router();
  app.use(basePath || '/', router);
  router.get('/health', (_req, res) => res.json({ok: true}));
  router.use(sessions);
  router.use(['/api', '/auth'], (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const loggedIn = (req, res, next) => {
    if (!req.session.user || !req.session.expiresAt || Date.now() >= req.session.expiresAt) return res.status(401).json({erro: 'Sua sessão expirou. Entre novamente com a conta Microsoft.'});
    next();
  };
  const csrf = (req, res, next) => {
    if (req.get('origin') !== origin || !req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) return res.status(403).json({erro: 'Solicitação inválida. Atualize a página e tente novamente.'});
    next();
  };
  const idValido = (nome) => (req, res, next) => (ehUuid(req.params[nome]) ? next() : res.status(404).json({erro: 'Não encontrado.'}));
  const owner = (req) => req.session.user.id;
  const writes = rateLimit({windowMs: 60000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false});
  const docs = rateLimit({windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false});

  router.get('/auth/login', rateLimit({windowMs: 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false}), auth.login);
  router.get('/auth/callback', auth.callback);
  router.post('/auth/logout', loggedIn, csrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie(COOKIE(production), {path: '/', secure: production, httpOnly: true, sameSite: 'lax'});
      res.json({ok: true});
    });
  });
  router.get('/api/me', loggedIn, (req, res) => { req.session.csrf ||= randomBytes(32).toString('hex'); res.json({user: req.session.user, csrf: req.session.csrf}); });
  router.use('/api', loggedIn);

  // ---------- reuniões ----------
  router.get('/api/reunioes', async (req, res) => res.json(await repo.listar(owner(req))));
  router.post('/api/reunioes', csrf, writes, express.json({limit: '16kb'}), async (req, res) => {
    const p = dadosReuniaoSchema.safeParse(req.body || {});
    if (!p.success) return res.status(400).json({erro: 'Confira os dados da reunião.'});
    res.status(201).json(await repo.criar(req.session.user, p.data));
  });
  router.get('/api/reunioes/:id', idValido('id'), async (req, res) => {
    const r = await repo.obter(owner(req), req.params.id);
    if (!r) return res.status(404).json({erro: 'Reunião não encontrada.'});
    res.json({...r, processando: processador.emAndamento(req.params.id)});
  });
  router.put('/api/reunioes/:id', idValido('id'), csrf, writes, express.json({limit: '16kb'}), async (req, res) => {
    const p = dadosReuniaoSchema.safeParse(req.body || {});
    if (!p.success) return res.status(400).json({erro: 'Confira os dados da reunião.'});
    const r = await repo.atualizarDados(owner(req), req.params.id, p.data);
    if (!r) return res.status(404).json({erro: 'Reunião não encontrada.'});
    res.json(r);
  });
  router.put('/api/reunioes/:id/ata', idValido('id'), csrf, writes, express.json({limit: '1mb'}), async (req, res) => {
    const p = ataSchema.safeParse(req.body || {});
    if (!p.success) return res.status(400).json({erro: 'Texto da ata inválido.'});
    const r = await repo.salvarAta(owner(req), req.params.id, p.data.ata);
    if (!r) return res.status(404).json({erro: 'Reunião não encontrada.'});
    res.json(r);
  });
  router.delete('/api/reunioes/:id', idValido('id'), csrf, writes, async (req, res) => {
    if (!await repo.excluir(owner(req), req.params.id)) return res.status(404).json({erro: 'Reunião não encontrada.'});
    res.json({ok: true});
  });

  // ---------- áudio ----------
  const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 25 * 1024 * 1024, files: 1, fields: 4, parts: 6}});
  router.post('/api/reunioes/:id/trechos', idValido('id'), csrf, writes, upload.single('audio'), async (req, res) => {
    const p = trechoSchema.safeParse(req.body || {});
    const mime = mimeAudio(req.file?.mimetype);
    if (!p.success || !req.file || !mime) return res.status(400).json({erro: 'Trecho de áudio inválido.'});
    const seg = await repo.salvarTrecho(owner(req), req.params.id, {ordem: p.data.ordem, duracao: p.data.duracao, mime, audio: req.file.buffer});
    if (!seg) return res.status(404).json({erro: 'Reunião não encontrada.'});
    processador.agendar(req.params.id);
    res.status(201).json(seg);
  });
  router.get('/api/trechos/:id/audio', idValido('id'), async (req, res) => {
    const a = await repo.audio(owner(req), req.params.id);
    if (!a) return res.status(404).json({erro: 'Áudio não encontrado.'});
    const dados = a.audio_data, total = dados.length;
    res.set({'Content-Type': a.mime, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store'});
    const faixa = faixaBytes(req.get('range'), total);
    if (faixa === 'invalida') return res.status(416).set('Content-Range', `bytes */${total}`).end();
    if (!faixa) return res.set('Content-Length', String(total)).send(dados);
    res.status(206).set({'Content-Range': `bytes ${faixa.inicio}-${faixa.fim}/${total}`, 'Content-Length': String(faixa.fim - faixa.inicio + 1)});
    res.end(dados.subarray(faixa.inicio, faixa.fim + 1));
  });
  router.delete('/api/reunioes/:id/audio', idValido('id'), csrf, writes, async (req, res) => {
    if (!await repo.apagarAudio(owner(req), req.params.id)) return res.status(404).json({erro: 'Reunião não encontrada.'});
    res.json({ok: true});
  });

  // ---------- processamento ----------
  router.post('/api/reunioes/:id/finalizar', idValido('id'), csrf, writes, express.json({limit: '2kb'}), async (req, res) => {
    const p = finalizarSchema.safeParse(req.body || {});
    if (!p.success) return res.status(400).json({erro: 'Duração inválida.'});
    const r = await repo.finalizar(owner(req), req.params.id, p.data.duracao_seg);
    if (!r) return res.status(409).json({erro: 'A ata desta reunião já está sendo escrita. Aguarde.'});
    processador.agendar(req.params.id);
    res.json(r);
  });
  router.post('/api/reunioes/:id/tentar-novamente', idValido('id'), csrf, writes, async (req, res) => {
    const r = await repo.tentarNovamente(owner(req), req.params.id);
    if (!r) return res.status(404).json({erro: 'Reunião não encontrada.'});
    processador.agendar(req.params.id);
    res.json(r);
  });
  router.post('/api/trechos/:id/tentar-novamente', idValido('id'), csrf, writes, async (req, res) => {
    const reuniaoId = await repo.tentarTrecho(owner(req), req.params.id);
    if (!reuniaoId) return res.status(404).json({erro: 'Trecho não encontrado.'});
    processador.agendar(reuniaoId);
    res.json({ok: true});
  });

  // ---------- PDF e Word ----------
  for (const [ext, tipo] of [['pdf', 'application/pdf'], ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']]) {
    router.get(`/api/reunioes/:id/${ext}`, idValido('id'), docs, async (req, res) => {
      const reu = await repo.reuniaoParaDocumento(owner(req), req.params.id);
      if (!reu) return res.status(404).json({erro: 'Reunião não encontrada.'});
      if (!reu.ata) return res.status(400).json({erro: 'Esta reunião ainda não tem ata.'});
      try {
        const buf = await documentos[ext](reu);
        const nome = nomeArquivo(reu, ext);
        res.set({'Content-Type': tipo, 'X-Nome-Arquivo': encodeURIComponent(nome), 'Content-Disposition': `attachment; filename="ata.${ext}"; filename*=UTF-8''${encodeURIComponent(nome)}`});
        res.send(buf);
      } catch (e) {
        console.error(`${ext}_falhou`, e?.code || e?.name, e?.message);
        res.status(e?.status || 500).json({erro: e?.status ? e.message : `Não consegui gerar o ${ext === 'pdf' ? 'PDF' : 'Word'} agora. Tente de novo.`});
      }
    });
  }

  // ---------- arquivos do app ----------
  const pagina = async (_req, res, next) => {
    try { res.type('html').set('Cache-Control', 'no-cache').send((await readFile(path.join(root, 'index.html'), 'utf8')).replaceAll('__APP_BASE__', basePath)); } catch (e) { next(e); }
  };
  router.get('/', pagina);
  router.get('/manifest.webmanifest', (_req, res) => res.type('application/manifest+json').set('Cache-Control', 'no-cache').json({
    id: basePath + '/', name: 'Solven Atas', short_name: 'Atas', description: 'Grave reuniões e gere a ata automaticamente.', lang: 'pt-BR',
    start_url: basePath + '/', scope: basePath + '/', display: 'standalone', orientation: 'portrait', background_color: '#f5f1ea', theme_color: '#013f7d',
    icons: [{src: basePath + '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable'}],
  }));
  for (const arq of ['app.js', 'style.css', 'sw.js']) router.get('/' + arq, (_req, res) => { res.set('Cache-Control', 'no-cache'); res.sendFile(path.join(root, arq)); });
  router.use('/icons', express.static(path.join(root, 'icons'), {maxAge: '7d', index: false}));
  router.use('/brand', express.static(path.join(root, 'brand'), {maxAge: '7d', index: false}));

  router.use((_req, res) => res.status(404).json({erro: 'Recurso não encontrado.'}));
  router.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) return res.status(400).json({erro: 'Trecho de áudio grande demais (limite de 25 MB).'});
    if (error.type === 'entity.too.large' || error.type === 'entity.parse.failed') return res.status(400).json({erro: 'Solicitação inválida.'});
    console.error('request_failed', error.code || error.name, error.message);
    res.status(500).json({erro: 'Não foi possível concluir a operação. Tente novamente.'});
  });
  return app;
}
