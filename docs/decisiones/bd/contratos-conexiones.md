# El contrato de conexiones no lleva secretos hacia el renderer y es una hoja sin imports de valor

- **Estado:** vigente
- **Ámbito:** `src/shared/db-ipc.ts`, `src/shared/motores/tipos.ts`, `src/main/db/`

## Contexto

Una conexión son los datos de acceso a una base, privados de un perfil, y existen para que el
agente explore y documente bases sin que el usuario dicte la URL y las credenciales en cada sesión.
El contrato lo importan el main, el preload, el renderer y `motores/` (sus tipos).

## Decisión

- La contraseña nunca cruza este contrato hacia el renderer. `DbConnection` es el DTO público y no
  tiene campo de secreto; `password` solo viaja de la UI al main, al crear o actualizar. El main la
  cifra con `safeStorage` y solo la descifra para pasarla a `tdb` como variable de entorno de un
  subproceso corto (ver [conexiones-tdb-como-subproceso.md](conexiones-tdb-como-subproceso.md)).
- Lo que cambia de un motor a otro no vive aquí sino en su descriptor (`shared/motores/`): la
  etiqueta es `descriptor(m).etiqueta` y el puerto por defecto `descriptor(m).conexion.puertoPorDefecto`.
  No hay tablas `MOTOR_LABEL` o `PUERTO_POR_DEFECTO` derivadas del registro: solo las leían las
  pruebas y obligaban a este módulo a importar el registro en ejecución.
- Es una hoja: sin imports de valor, para que ningún importador de un tipo de conexión arrastre el
  registro ni cierre un ciclo. Lo fija `test-motores`.
- Un motor de archivo (SQLite) no guarda su ruta en el contrato: la guarda el main y aquí solo
  cruzan su origen (`DbOrigenArchivo`: una ficha del diálogo nativo o un archivo del proyecto) y su
  nombre visible (`archivoVisible`), más los canales `ARCHIVO_*`.
- `DialectoSql` coincide con los motores SQL (los que tienen dialecto, consola SQL, rejilla y
  catálogo de esquemas): un motor de otra familia no puede tener fila en `REGLAS`,
  `ESCRITURA_SQL` ni `MOTORES_EXPLORADOR` ni por descuido.

## Consecuencias

`DbEsquemasVisibles` y el nivel «Bases» son opcionales a propósito: las conexiones guardadas antes
no los tienen y las pruebas que construyen un `DbConnection` a mano no deben romperse. Ausente
equivale a solo el esquema (o la base) por defecto.
