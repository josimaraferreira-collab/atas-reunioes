/* Solven Atas — 1/3: criar o banco atas_bd e dar acesso ao login pwa.
   Execute uma vez como DBA no SQL Server 192.168.0.250 (o mesmo do Controle de Despesas).
   O login [pwa] já existe no servidor; aqui ele só ganha um usuário dentro do atas_bd. */

IF DB_ID(N'atas_bd') IS NULL
    CREATE DATABASE [atas_bd];
GO

USE [atas_bd];
GO

IF DATABASE_PRINCIPAL_ID(N'pwa') IS NULL
    CREATE USER [pwa] FOR LOGIN [pwa] WITH DEFAULT_SCHEMA = [dbo];
GO
