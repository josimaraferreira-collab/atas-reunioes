/* Solven Atas — 2/3: tabelas. Execute uma vez como DBA no banco atas_bd.
   O processo da aplicação não cria nem altera tabelas. */
USE [atas_bd];
GO

IF OBJECT_ID(N'dbo.ata_reunioes', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.ata_reunioes (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ata_reunioes PRIMARY KEY,
  owner NVARCHAR(200) NOT NULL,             -- tenant:objectId do usuário Microsoft
  owner_name NVARCHAR(100) NOT NULL,
  owner_email NVARCHAR(320) NULL,
  titulo NVARCHAR(200) NOT NULL,
  data_reuniao DATETIME2(3) NOT NULL CONSTRAINT DF_ata_reunioes_data DEFAULT SYSUTCDATETIME(),
  local NVARCHAR(200) NULL,
  participantes NVARCHAR(2000) NULL,
  pauta NVARCHAR(4000) NULL,
  duracao_seg INT NOT NULL CONSTRAINT DF_ata_reunioes_duracao DEFAULT 0,
  status VARCHAR(20) NOT NULL CONSTRAINT DF_ata_reunioes_status DEFAULT 'gravando'
   CONSTRAINT CK_ata_reunioes_status CHECK (status IN ('gravando','transcrevendo','gerando_ata','pronta','erro')),
  ata NVARCHAR(MAX) NULL,
  erro NVARCHAR(1000) NULL,
  audio_apagado BIT NOT NULL CONSTRAINT DF_ata_reunioes_audio_apagado DEFAULT 0,
  created_at DATETIME2(3) NOT NULL CONSTRAINT DF_ata_reunioes_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_ata_reunioes_updated DEFAULT SYSUTCDATETIME()
 );
 CREATE INDEX IX_ata_reunioes_owner ON dbo.ata_reunioes(owner, data_reuniao DESC);
 CREATE INDEX IX_ata_reunioes_status ON dbo.ata_reunioes(status) WHERE status IN ('transcrevendo','gerando_ata');
END;
GO

IF OBJECT_ID(N'dbo.ata_segmentos', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.ata_segmentos (
  id UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_ata_segmentos PRIMARY KEY,
  reuniao_id UNIQUEIDENTIFIER NOT NULL
   CONSTRAINT FK_ata_segmentos_reuniao REFERENCES dbo.ata_reunioes(id) ON DELETE CASCADE,
  ordem INT NOT NULL CONSTRAINT CK_ata_segmentos_ordem CHECK (ordem >= 0),
  mime VARCHAR(50) NOT NULL,
  duracao_seg INT NOT NULL CONSTRAINT DF_ata_segmentos_duracao DEFAULT 0,
  audio_bytes INT NOT NULL CONSTRAINT DF_ata_segmentos_bytes DEFAULT 0,
  audio_data VARBINARY(MAX) NULL,            -- trecho de até 10 min; NULL depois de "Apagar o áudio"
  status VARCHAR(20) NOT NULL CONSTRAINT DF_ata_segmentos_status DEFAULT 'pendente'
   CONSTRAINT CK_ata_segmentos_status CHECK (status IN ('pendente','processando','ok','erro')),
  transcricao NVARCHAR(MAX) NULL,
  erro NVARCHAR(1000) NULL,
  created_at DATETIME2(3) NOT NULL CONSTRAINT DF_ata_segmentos_created DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2(3) NOT NULL CONSTRAINT DF_ata_segmentos_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_ata_segmentos_ordem UNIQUE (reuniao_id, ordem),
  CONSTRAINT CK_ata_segmentos_tamanho CHECK (audio_data IS NULL OR DATALENGTH(audio_data) <= 26214400)
 );
END;
GO

IF OBJECT_ID(N'dbo.app_sessions', N'U') IS NULL
BEGIN
 CREATE TABLE dbo.app_sessions (
  sid NVARCHAR(128) NOT NULL CONSTRAINT PK_app_sessions PRIMARY KEY,
  sess NVARCHAR(MAX) NOT NULL,
  expires DATETIME2(3) NOT NULL
 );
 CREATE INDEX IX_app_sessions_expires ON dbo.app_sessions(expires);
END;
GO
