# Los ajustes de Bases de datos son cuatro, con lista cerrada y saneados en un solo módulo

- **Estado:** vigente
- **Ámbito:** `src/shared/ajustesBd.ts`, `src/shared/workspace-state-ipc.ts`, `src/main/db/explorador/sesiones/`

## Contexto

Los mismos valores los leen el saneado del estado del workspace, el main (el gestor de sesiones)
y el renderer (panel, rejilla, consola). Si cada uno los sanea por su cuenta, un archivo escrito
a mano o de otra versión da tres números distintos.

## Decisión

- Se exponen solo cuatro ajustes: tamaño de letra de la vista, filas por página, transacción al
  abrir una consola e inactividad de la consola. Los topes de procesos, consolas y lectores, el
  presupuesto de celdas, los 4 MiB por respuesta y el barrido no se exponen: solo sirven para
  romper. Ninguno afecta a `tdb`, que tiene sus propios límites.
- **Tamaño de letra:** `0` o ausente = «igual que el Explorador», que a su vez puede heredar de
  la interfaz. Su saneado es el de los otros tamaños; aquí no hay nada suyo.
- **Filas por página:** una lista (100…`DB_PAGINA_MAX`) y no un número libre; un valor fuera de la
  lista vuelve al 500, no al más cercano. El techo es el que el main ya valida, así que ninguna
  opción puede ser rechazada. Se aplica en la siguiente lectura.
- **Transacción al abrir:** solo decide lo que no es producción ni solo lectura (ver
  `transacciones-produccion-y-manual.md`). Viaja en cada petición que puede crear la sesión y el
  main la valida con `txInicialDePeticion` (ausente = la que recibió por los ajustes). Su ayuda
  dice a quién afecta: a las consolas sin sesión, también las pestañas abiertas que no han
  ejecutado nada.
- **Inactividad:** «Nunca» es `0` en el archivo e `Infinity` para la máquina de estados. Una
  consola con transacción pendiente no se cierra con ningún valor: lo decide la máquina.
- Llegan al main por `SAVE_SETTINGS` y al arrancar; el main no lee archivos del renderer.

## Descartes

- Llevar la preferencia en cada petición en vez de no crear la sesión hasta ejecutar: fijar el
  esquema o el modo de una consola que aún no ha ejecutado nada tiene que guardarse en la sesión.
- Que una pestaña fije su modo al abrirse: otro estado por pestaña que puede discrepar de la barra.
- La transacción por entorno o por conexión: el entorno ya es el control por conexión y producción
  está resuelto; por conexión multiplica casillas.
