# Campos opcionales de una conexión: solo los que el motor declara, y la forma en disco no cambia

- **Estado:** vigente
- **Ámbito:** `src/main/db/opcionalesConexion.ts`

## Contexto

SQL Server, MongoDB y Redis traen campos que Oracle y PostgreSQL no tienen (instancia, autenticación, dominio,
cifrado, SRV, opciones de URI, usuario opcional, base numérica). La huella del destino que `tdb` compara con
la contraseña se calcula sobre el registro: cualquier campo de más o en otro orden la cambia.

## Decisión

- Un motor guarda solo los opcionales que declara en `conexion.opcionales`; lo que quedó escrito en el borrador
  con otro motor no viaja. El registro de un Oracle o un PostgreSQL no cambia ni un byte.
- `dominio` solo se guarda con una autenticación que lo pide; `tls` se guarda como objeto nuevo con sus dos claves
  en orden fijo. Con `tlsPorDefecto` propio (MongoDB) se guarda siempre el cifrado efectivo, para que el agente
  conecte con lo mismo que el explorador; con `srv` y sin cifrado escrito, cifrar.
- El usuario opcional (`usuarioAGuardar`) es siempre presente en el registro (`''` = sin usuario).
- La base por defecto de un motor de claves es un número de 0 a `MAX_BASE_CLAVES`, validado con la misma
  función que el formulario para que las dos puntas rechacen lo mismo.

## Descartes

- Validar la instancia contra las reglas de nombre de SQL Server: son del instalador, y un nombre que no las
  cumpla no puede existir; el servidor ya contestará. Solo se rechaza lo que seguro es un error de casilla.
