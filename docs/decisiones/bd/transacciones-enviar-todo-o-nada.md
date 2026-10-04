# «Enviar» de la rejilla SQL: todo o nada en una sesión efímera propia

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/sesiones/envio.ts` (con `edicionRejilla.ts` y el controlador)

## Contexto

La rejilla aplica varios cambios de una vez. Un fallo a medias, una fila bloqueada por otra
transacción o un Stop no pueden dejar la mitad escrita ni esperar sin plazo.

## Decisión

- Sesión EFÍMERA propia de ese envío (`sesionEdicion`), nunca `datos`: allí la transacción se
  mezclaría con las lecturas de todas las pestañas y un fallo dejaría cambios pendientes que
  nadie sabe resolver. Con su propia conexión, un ROLLBACK no toca nada ajeno y cerrarla revierte.
- TODO O NADA: cada DML debe tocar EXACTAMENTE una fila; al primer fallo, ROLLBACK y el índice
  del cambio. Las sentencias las construye el controlador con la función de la vista previa
  (`edicionRejilla.ts`); el gestor solo ejecuta.
- Espera de bloqueos ACOTADA y antes de escribir: ver
  [rejilla-envio-bloqueos.md](rejilla-envio-bloqueos.md). SQLite bloquea el ARCHIVO entero: antes
  de empezar se mira si otra consola de Tessera tiene una transacción sobre él y se dice cuál.
- El Stop: entre dos sentencias lo corta `pararEntreSentencias`; con la ÚLTIMA en vuelo y ya
  terminada, se mira otra vez ANTES del COMMIT y se revierte con el índice de esa última (nunca
  -1, que es un COMMIT fallido). Con el COMMIT en camino no se para: el trabajador nunca
  interrumpe un `tx`.
- Producción sin `confirmado` y solo lectura impuesta se rechazan sin abrir nada (segunda
  barrera). La comprobación del archivo de SQLite es SÍNCRONA: el envío se encola en el mismo
  turno en que llega, que es lo que permite a un Stop de la preparación encontrarlo.

## Consecuencias

- `correrEnvio` va por fases en este orden (base, candado, cambios, Stop, COMMIT) dentro de un
  único `try` que termina la sesión pase lo que pase.

## Descartes

- Un SAVEPOINT por cambio para aplicar «los que se puedan»: decidido con el usuario, todo o nada.
