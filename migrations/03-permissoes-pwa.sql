/* Solven Atas — 3/3: permissões mínimas do usuário pwa no atas_bd.
   Execute como DBA depois do 02-schema.sql. O pwa só lê e grava dados; não cria tabelas. */
USE [atas_bd];
GO

IF IS_ROLEMEMBER(N'db_owner', N'pwa') = 1
    ALTER ROLE [db_owner] DROP MEMBER [pwa];
GO

GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.ata_reunioes TO [pwa];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.ata_segmentos TO [pwa];
GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::dbo.app_sessions TO [pwa];
GO

-- Conferência: todas as colunas devem voltar 1, menos database_control (0).
EXECUTE AS USER = N'pwa';
SELECT
    DB_NAME() AS banco,
    HAS_PERMS_BY_NAME(N'dbo.ata_reunioes', N'OBJECT', N'SELECT') AS reunioes_select,
    HAS_PERMS_BY_NAME(N'dbo.ata_reunioes', N'OBJECT', N'INSERT') AS reunioes_insert,
    HAS_PERMS_BY_NAME(N'dbo.ata_reunioes', N'OBJECT', N'UPDATE') AS reunioes_update,
    HAS_PERMS_BY_NAME(N'dbo.ata_reunioes', N'OBJECT', N'DELETE') AS reunioes_delete,
    HAS_PERMS_BY_NAME(N'dbo.ata_segmentos', N'OBJECT', N'SELECT') AS segmentos_select,
    HAS_PERMS_BY_NAME(N'dbo.ata_segmentos', N'OBJECT', N'INSERT') AS segmentos_insert,
    HAS_PERMS_BY_NAME(N'dbo.ata_segmentos', N'OBJECT', N'UPDATE') AS segmentos_update,
    HAS_PERMS_BY_NAME(N'dbo.ata_segmentos', N'OBJECT', N'DELETE') AS segmentos_delete,
    HAS_PERMS_BY_NAME(N'dbo.app_sessions', N'OBJECT', N'SELECT') AS sessoes_select,
    HAS_PERMS_BY_NAME(N'dbo.app_sessions', N'OBJECT', N'DELETE') AS sessoes_delete,
    HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CONTROL') AS database_control;
REVERT;
GO
