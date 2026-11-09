// Acesso ao SQL Server (banco atas_bd). Cada usuário só enxerga as próprias reuniões (coluna owner).
import {randomUUID} from 'node:crypto';
import sql from 'mssql';

const COLS_REU = 'id,titulo,data_reuniao,local,participantes,pauta,duracao_seg,status,ata,erro,audio_apagado,created_at,updated_at';
const COLS_SEG = 'id,reuniao_id,ordem,mime,duracao_seg,audio_bytes,status,transcricao,erro';

const iso = (d) => (d instanceof Date ? d.toISOString() : d);
export const formaReuniao = (r) => r && ({
  id: String(r.id).toLowerCase(), titulo: r.titulo, data_reuniao: iso(r.data_reuniao), local: r.local, participantes: r.participantes,
  pauta: r.pauta, duracao_seg: Number(r.duracao_seg || 0), status: r.status, ata: r.ata ?? null, erro: r.erro, audio_apagado: Boolean(r.audio_apagado),
  created_at: iso(r.created_at), updated_at: iso(r.updated_at),
});
export const formaSegmento = (s) => s && ({
  id: String(s.id).toLowerCase(), reuniao_id: String(s.reuniao_id).toLowerCase(), ordem: s.ordem, mime: s.mime, duracao_seg: Number(s.duracao_seg || 0),
  audio_bytes: Number(s.audio_bytes || 0), status: s.status, transcricao: s.transcricao, erro: s.erro,
});

function req(pool, valores = []) {
  const r = pool.request();
  for (const [nome, tipo, valor] of valores) r.input(nome, tipo, valor);
  return r;
}
const U = sql.UniqueIdentifier, OWNER = sql.NVarChar(200);

export function repository(pool) {
  const um = async (valores, query) => (await req(pool, valores).query(query)).recordset[0] || null;
  const todos = async (valores, query) => (await req(pool, valores).query(query)).recordset;

  return {
    // ---------- usadas pelas rotas (sempre com o dono) ----------
    async listar(owner) {
      const rows = await todos([['owner', OWNER, owner]], 'SELECT id,titulo,data_reuniao,local,duracao_seg,status,audio_apagado,created_at,updated_at FROM dbo.ata_reunioes WHERE owner=@owner ORDER BY data_reuniao DESC');
      return rows.map(formaReuniao);
    },
    async criar(user, dados) {
      const r = await um([
        ['id', U, randomUUID()], ['owner', OWNER, user.id], ['owner_name', sql.NVarChar(100), user.name], ['owner_email', sql.NVarChar(320), user.email || null],
        ['titulo', sql.NVarChar(200), dados.titulo], ['local', sql.NVarChar(200), dados.local], ['participantes', sql.NVarChar(2000), dados.participantes], ['pauta', sql.NVarChar(4000), dados.pauta],
      ], `INSERT INTO dbo.ata_reunioes (id,owner,owner_name,owner_email,titulo,local,participantes,pauta,status)
          OUTPUT INSERTED.${COLS_REU.split(',').join(', INSERTED.')}
          VALUES (@id,@owner,@owner_name,@owner_email,@titulo,@local,@participantes,@pauta,'gravando')`);
      return formaReuniao(r);
    },
    async obter(owner, id) {
      const reuniao = formaReuniao(await um([['owner', OWNER, owner], ['id', U, id]], `SELECT ${COLS_REU} FROM dbo.ata_reunioes WHERE id=@id AND owner=@owner`));
      if (!reuniao) return null;
      const segmentos = (await todos([['id', U, id]], `SELECT ${COLS_SEG} FROM dbo.ata_segmentos WHERE reuniao_id=@id ORDER BY ordem`)).map(formaSegmento);
      return {reuniao, segmentos};
    },
    async atualizarDados(owner, id, dados) {
      return formaReuniao(await um([
        ['owner', OWNER, owner], ['id', U, id], ['titulo', sql.NVarChar(200), dados.titulo], ['local', sql.NVarChar(200), dados.local],
        ['participantes', sql.NVarChar(2000), dados.participantes], ['pauta', sql.NVarChar(4000), dados.pauta],
      ], `UPDATE dbo.ata_reunioes SET titulo=@titulo,local=@local,participantes=@participantes,pauta=@pauta,updated_at=SYSUTCDATETIME()
          OUTPUT INSERTED.${COLS_REU.split(',').join(', INSERTED.')} WHERE id=@id AND owner=@owner`));
    },
    async salvarAta(owner, id, ata) {
      return formaReuniao(await um([['owner', OWNER, owner], ['id', U, id], ['ata', sql.NVarChar(sql.MAX), ata]],
        `UPDATE dbo.ata_reunioes SET ata=@ata,updated_at=SYSUTCDATETIME() OUTPUT INSERTED.${COLS_REU.split(',').join(', INSERTED.')} WHERE id=@id AND owner=@owner`));
    },
    async salvarTrecho(owner, reuniaoId, {ordem, duracao, mime, audio}) {
      // só aceita trechos de reunião do próprio usuário; regrava o trecho se o mesmo número chegar de novo
      return formaSegmento(await um([
        ['owner', OWNER, owner], ['reuniao_id', U, reuniaoId], ['id', U, randomUUID()], ['ordem', sql.Int, ordem], ['duracao', sql.Int, duracao],
        ['mime', sql.VarChar(50), mime], ['audio', sql.VarBinary(sql.MAX), audio], ['bytes', sql.Int, audio.length],
      ], `SET XACT_ABORT ON;
          IF NOT EXISTS (SELECT 1 FROM dbo.ata_reunioes WHERE id=@reuniao_id AND owner=@owner) BEGIN SELECT ${COLS_SEG} FROM dbo.ata_segmentos WHERE 1=0; RETURN; END;
          MERGE dbo.ata_segmentos WITH (HOLDLOCK) AS t
          USING (SELECT @reuniao_id AS reuniao_id, @ordem AS ordem) AS s ON t.reuniao_id=s.reuniao_id AND t.ordem=s.ordem
          WHEN MATCHED THEN UPDATE SET mime=@mime,duracao_seg=@duracao,audio_data=@audio,audio_bytes=@bytes,status='pendente',transcricao=NULL,erro=NULL,updated_at=SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (id,reuniao_id,ordem,mime,duracao_seg,audio_data,audio_bytes,status) VALUES (@id,@reuniao_id,@ordem,@mime,@duracao,@audio,@bytes,'pendente')
          OUTPUT INSERTED.${COLS_SEG.split(',').join(', INSERTED.')};`));
    },
    async finalizar(owner, id, duracaoSeg) {
      // encerra a gravação (ou pede de novo a ata) e deixa a reunião na fila de processamento
      return formaReuniao(await um([['owner', OWNER, owner], ['id', U, id], ['duracao', sql.Int, duracaoSeg ?? null]],
        `UPDATE r SET status='transcrevendo',erro=NULL,updated_at=SYSUTCDATETIME(),
           duracao_seg=COALESCE(@duracao, NULLIF(r.duracao_seg,0), (SELECT COALESCE(SUM(duracao_seg),0) FROM dbo.ata_segmentos WHERE reuniao_id=r.id))
         OUTPUT INSERTED.${COLS_REU.split(',').join(', INSERTED.')}
         FROM dbo.ata_reunioes r WHERE r.id=@id AND r.owner=@owner AND r.status<>'gerando_ata'`));
    },
    async tentarNovamente(owner, id) {
      return formaReuniao(await um([['owner', OWNER, owner], ['id', U, id]],
        `SET XACT_ABORT ON; BEGIN TRAN;
         UPDATE s SET status='pendente',erro=NULL,updated_at=SYSUTCDATETIME() FROM dbo.ata_segmentos s JOIN dbo.ata_reunioes r ON r.id=s.reuniao_id
           WHERE r.id=@id AND r.owner=@owner AND s.status IN ('erro','processando') AND s.audio_data IS NOT NULL;
         UPDATE dbo.ata_reunioes SET status='transcrevendo',erro=NULL,updated_at=SYSUTCDATETIME()
           OUTPUT INSERTED.${COLS_REU.split(',').join(', INSERTED.')} WHERE id=@id AND owner=@owner;
         COMMIT;`));
    },
    async tentarTrecho(owner, segId) {
      return um([['owner', OWNER, owner], ['seg', U, segId]],
        `SET XACT_ABORT ON; BEGIN TRAN;
         DECLARE @r UNIQUEIDENTIFIER = (SELECT s.reuniao_id FROM dbo.ata_segmentos s JOIN dbo.ata_reunioes r ON r.id=s.reuniao_id WHERE s.id=@seg AND r.owner=@owner AND s.audio_data IS NOT NULL);
         IF @r IS NULL BEGIN ROLLBACK; SELECT CAST(NULL AS UNIQUEIDENTIFIER) AS reuniao_id WHERE 1=0; RETURN; END;
         UPDATE dbo.ata_segmentos SET status='pendente',erro=NULL,updated_at=SYSUTCDATETIME() WHERE id=@seg;
         UPDATE dbo.ata_reunioes SET status=CASE WHEN status='gravando' THEN status ELSE 'transcrevendo' END,erro=NULL,updated_at=SYSUTCDATETIME() WHERE id=@r;
         COMMIT; SELECT @r AS reuniao_id;`).then((r) => (r ? String(r.reuniao_id).toLowerCase() : null));
    },
    async audio(owner, segId) {
      return um([['owner', OWNER, owner], ['seg', U, segId]],
        'SELECT s.mime,s.audio_data,s.ordem FROM dbo.ata_segmentos s JOIN dbo.ata_reunioes r ON r.id=s.reuniao_id WHERE s.id=@seg AND r.owner=@owner AND s.audio_data IS NOT NULL');
    },
    async apagarAudio(owner, id) {
      const r = await um([['owner', OWNER, owner], ['id', U, id]],
        `SET XACT_ABORT ON; BEGIN TRAN;
         IF NOT EXISTS (SELECT 1 FROM dbo.ata_reunioes WHERE id=@id AND owner=@owner) BEGIN ROLLBACK; SELECT 0 AS ok; RETURN; END;
         UPDATE dbo.ata_segmentos SET audio_data=NULL,updated_at=SYSUTCDATETIME() WHERE reuniao_id=@id;
         UPDATE dbo.ata_reunioes SET audio_apagado=1,updated_at=SYSUTCDATETIME() WHERE id=@id;
         COMMIT; SELECT 1 AS ok;`);
      return Boolean(r?.ok);
    },
    async excluir(owner, id) {
      const r = await req(pool, [['owner', OWNER, owner], ['id', U, id]]).query('DELETE FROM dbo.ata_reunioes WHERE id=@id AND owner=@owner');
      return r.rowsAffected[0] > 0;
    },
    async reuniaoParaDocumento(owner, id) {
      return formaReuniao(await um([['owner', OWNER, owner], ['id', U, id]], `SELECT ${COLS_REU} FROM dbo.ata_reunioes WHERE id=@id AND owner=@owner`));
    },

    // ---------- usadas pelo processador em segundo plano ----------
    async reunioesPendentes() {
      const rows = await todos([], `SELECT DISTINCT r.id FROM dbo.ata_reunioes r LEFT JOIN dbo.ata_segmentos s ON s.reuniao_id=r.id
        WHERE r.status IN ('transcrevendo','gerando_ata') OR s.status IN ('pendente','processando')`);
      return rows.map((r) => String(r.id).toLowerCase());
    },
    async liberarProcessando() {
      // depois de reiniciar o serviço, nada fica preso como "processando"
      await req(pool).query(`UPDATE dbo.ata_segmentos SET status='pendente' WHERE status='processando';
        UPDATE dbo.ata_reunioes SET status='transcrevendo' WHERE status='gerando_ata';`);
    },
    async reuniaoInterna(id) {
      return formaReuniao(await um([['id', U, id]], `SELECT ${COLS_REU} FROM dbo.ata_reunioes WHERE id=@id`));
    },
    async statusSegmentos(id) {
      return (await todos([['id', U, id]], 'SELECT id,ordem,status,duracao_seg,transcricao FROM dbo.ata_segmentos WHERE reuniao_id=@id ORDER BY ordem')).map((s) => ({...s, id: String(s.id).toLowerCase()}));
    },
    async pegarTrecho(segId) {
      // marca como "processando" e devolve o áudio, só se ainda estiver pendente
      return um([['seg', U, segId]], `UPDATE dbo.ata_segmentos SET status='processando',erro=NULL,updated_at=SYSUTCDATETIME()
        OUTPUT INSERTED.id,INSERTED.reuniao_id,INSERTED.ordem,INSERTED.mime,INSERTED.audio_data
        WHERE id=@seg AND status IN ('pendente','processando')`);
    },
    async concluirTrecho(segId, {status, transcricao = null, erro = null}) {
      await req(pool, [['seg', U, segId], ['status', sql.VarChar(20), status], ['t', sql.NVarChar(sql.MAX), transcricao], ['erro', sql.NVarChar(1000), erro ? String(erro).slice(0, 1000) : null]])
        .query('UPDATE dbo.ata_segmentos SET status=@status,transcricao=COALESCE(@t,transcricao),erro=@erro,updated_at=SYSUTCDATETIME() WHERE id=@seg');
    },
    async statusReuniao(id, status, {erro = null, ata} = {}) {
      const valores = [['id', U, id], ['status', sql.VarChar(20), status], ['erro', sql.NVarChar(1000), erro ? String(erro).slice(0, 1000) : null]];
      if (ata !== undefined) valores.push(['ata', sql.NVarChar(sql.MAX), ata]);
      await req(pool, valores).query(`UPDATE dbo.ata_reunioes SET status=@status,erro=@erro${ata !== undefined ? ',ata=@ata' : ''},updated_at=SYSUTCDATETIME() WHERE id=@id`);
    },
  };
}
