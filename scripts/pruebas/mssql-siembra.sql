-- Siembra idempotente del SQL Server de pruebas (la corre `mssql.sh levantar` como sa).
-- $(PW) es una variable de sqlcmd: la clave nunca se escribe aquí.
IF DB_ID('pruebas') IS NULL CREATE DATABASE pruebas;
GO
IF SUSER_ID('tessera') IS NULL CREATE LOGIN tessera WITH PASSWORD = '$(PW)', CHECK_POLICY = OFF, DEFAULT_DATABASE = pruebas;
IF SUSER_ID('lector') IS NULL CREATE LOGIN lector WITH PASSWORD = '$(PW)', CHECK_POLICY = OFF, DEFAULT_DATABASE = pruebas;
GO
USE pruebas;
IF USER_ID('tessera') IS NULL CREATE USER tessera FOR LOGIN tessera;
IF USER_ID('lector') IS NULL CREATE USER lector FOR LOGIN lector;
ALTER ROLE db_owner ADD MEMBER tessera;
ALTER ROLE db_datareader ADD MEMBER lector;
IF OBJECT_ID('dbo.t') IS NULL
BEGIN
  CREATE TABLE dbo.t (id int PRIMARY KEY, nombre nvarchar(50));
  INSERT INTO dbo.t VALUES (1, N'uno'), (2, N'dos'), (3, N'tres');
END
GO
