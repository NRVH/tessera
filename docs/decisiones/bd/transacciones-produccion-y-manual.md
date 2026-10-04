# Producción informa y pide confirmar; sus consolas nacen en Manual

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/produccion.ts`, `sesiones/NucleoSesiones.ts`, `sesiones/cicloDeVida.ts`, `sesiones/consola.ts`, `sesiones/transacciones.ts`

## Contexto

Una conexión con `entorno: 'produccion'` necesita que nada se escriba por descuido, pero Tessera
informa y no prohíbe (principio del producto, no se re-litiga).

## Decisión

- Pide confirmación antes de CADA escritura (DML, DDL, PL/SQL y el COMMIT del botón; «Enviar»),
  con el nombre de la conexión. El renderer pregunta y manda `confirmado`; el main es la SEGUNDA
  barrera y sin él responde 'produccion' sin enviar nada. Qué pide confirmación lo dice
  `shared/sql/produccionSql.ts`, el MISMO módulo que usa la consola. Las demás vías (pasar a
  Auto, cerrar, salir) no la piden: no se añaden barreras.
- Sus consolas NUEVAS nacen en Manual (`modoTxInicial`, compartida con el renderer); el usuario
  puede pasar a Auto a conciencia. La preferencia «Transacción al abrir» solo decide lo que no
  es producción ni solo lectura, y la trae cada petición que puede CREAR la sesión.
- Una consola ocupada cuando su conexión PASA a producción se pone en Manual al quedar libre
  (`manualPendiente`), con el «solo lectura» de la conexión de ESE momento, no el de la sesión.
  Lo mismo al DEJAR de ser de solo lectura con la preferencia en Manual ('preferencia'), y nunca
  sobre una transacción pendiente.
- Sin sesión, `estadoConsola` devuelve null y la barra pinta el modo con que nacerá sobre la
  conexión viva.
- Si se impone solo lectura, manda sobre producción: su guardia va antes y la consola nace en
  Auto (la invariante de la máquina).

## Descartes

- Devolver una sesión «cerrada» inventada con el modo de nacimiento: el renderer la leía una vez
  y la barra se congelaba (un «Manual» falso tras pasar a desarrollo, y la primera escritura se
  confirmaba sola).
- Manual siempre en producción: pasar a Auto es una decisión consciente del usuario.
