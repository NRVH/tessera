-- Siembra idempotente de los Oracle de pruebas (la corre `oracle.sh levantar` como SYSTEM).
-- __PW__ lo sustituye el script por la clave de pruebas; nunca se escribe aquí.
grant select_catalog_role to tessera;
grant execute on sys.dbms_lock to tessera;
create or replace directory TESSERA_EXT_DIR as '/tmp';
grant read, write on directory TESSERA_EXT_DIR to tessera;
grant execute on sys.utl_file to tessera;
-- El usuario SIN select_catalog_role del repliegue de «Ver DDL» (ORA-01920 si ya existe).
create user tessera_sin identified by "__PW__";
grant create session to tessera_sin;
select granted_role from dba_role_privs where grantee = 'TESSERA';
