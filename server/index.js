import sql from 'mssql';
import session from 'express-session';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp, COOKIE} from './app.js';
import {createAuth} from './auth.js';
import {repository} from './repository.js';
import {SqlServerSessionStore} from './session-store.js';
import {criarGemini} from './gemini.js';
import {criarProcessador} from './processador.js';
import {criarDocumentos} from './documentos.js';

const env = process.env, production = env.NODE_ENV === 'production';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const key of ['APP_URL', 'ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'SESSION_SECRET', 'DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'GEMINI_API_KEY']) {
  if (!env[key]) throw Error('Configuração obrigatória ausente: ' + key);
}
if (env.SESSION_SECRET.length < 32) throw Error('SESSION_SECRET precisa ter pelo menos 32 caracteres aleatórios.');
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!guid.test(env.ENTRA_TENANT_ID) || !guid.test(env.ENTRA_CLIENT_ID)) throw Error('Tenant e Client ID devem ser GUIDs.');
const url = new URL(env.APP_URL), origin = url.origin, basePath = url.pathname.replace(/\/$/, '');
if (url.search || url.hash || basePath.split('/').some((p) => p === '..' || p === '.')) throw Error('APP_URL deve conter somente o endereço público e o caminho do aplicativo.');
if (production && url.protocol !== 'https:') throw Error('Produção exige HTTPS.');
if (!production && !['localhost', '127.0.0.1'].includes(url.hostname)) throw Error('Modo de desenvolvimento permitido somente no localhost.');

const pool = new sql.ConnectionPool({
  server: env.DB_SERVER, port: Number(env.DB_PORT || 1433), database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD,
  options: {encrypt: env.DB_ENCRYPT !== 'false', trustServerCertificate: env.DB_TRUST_SERVER_CERTIFICATE === 'true', enableArithAbort: true},
  pool: {min: 0, max: 10, idleTimeoutMillis: 30000}, connectionTimeout: 15000, requestTimeout: 60000,
});
pool.on('error', (e) => console.error('database_pool_error', e.code || e.name));
await pool.connect();

const sessionStore = new SqlServerSessionStore(pool);
const sessionMs = Math.min(24, Math.max(1, Number(env.SESSION_HOURS || 12))) * 60 * 60 * 1000;
const sessions = session({
  store: sessionStore, name: COOKIE(production), secret: env.SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: {httpOnly: true, secure: production, sameSite: 'lax', maxAge: sessionMs, path: '/'},
});
const auth = await createAuth({tenant: env.ENTRA_TENANT_ID.toLowerCase(), clientId: env.ENTRA_CLIENT_ID, clientSecret: env.ENTRA_CLIENT_SECRET, origin, basePath, requiredRole: env.ENTRA_REQUIRED_ROLE || '', sessionMs});
const repo = repository(pool);
const gemini = criarGemini({chave: env.GEMINI_API_KEY, modelo: env.GEMINI_MODEL});
const processador = criarProcessador({repo, gemini});
const documentos = criarDocumentos({navegadorPath: env.PDF_BROWSER_PATH || '', pastaDados: env.DATA_DIR || path.join(root, 'data')});

const app = createApp({repo, sessions, auth, processador, documentos, origin, basePath, production, trustProxy: env.TRUST_PROXY === '1' ? 1 : 0});
const server = app.listen(Number(env.PORT || 3001), '127.0.0.1', () => console.log('Solven Atas iniciado em', basePath || '/'));
server.requestTimeout = 5 * 60 * 1000;
processador.retomar().then((n) => { if (n) console.log('Reuniões retomadas:', n); }).catch((e) => console.error('retomar_falhou', e.code || e.name));

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  sessionStore.close();
  documentos.fechar();
  server.close(() => pool.close().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
});
