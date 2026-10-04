# La vista de BD lee las conexiones por perfil de interés en un solo estado y las sesiones como foto más cambios

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/useConexionesBd.ts`, `useSesionesBd.ts`

## Contexto

El área mantiene vivas las pestañas de todos los perfiles y cada pane necesita su conexión; el
registro puede cambiar desde otro sitio (el diálogo, el agente con `tdb`), responder fuera de
orden, fallar o venir en un formato que esta versión no entiende. Y `useBdApp` poda pestañas y
selección con lo que ve en UN render.

## Decisión

- Conexiones POR PERFIL de interés (el activo más los que tienen pestañas); los que dejan de
  interesar se sueltan. Suscrito a `db.onChanged`, que no dice qué perfil: se recargan todos los
  de interés (pocos y un JSON local).
- Generación por perfil: una respuesta vieja se tira en vez de pisar la nueva.
- Identidad estable: una lista igual conserva el objeto anterior, y cada mapa por su lado (que
  cambien solo las ajenas no renueva `porPerfil`, del que cuelgan la poda y el área).
- Conocidas y AJENAS llegan en UNA petición (`db.listCompleta`) y se aplican en UNA
  actualización, junto con el aviso de formato ajeno: si llegaran en renders distintos, la poda
  vería una ajena seleccionada como muerta, o dos listas vacías sin su marca y cerraría pestañas.
- Un fallo de lectura avisa una vez por perfil y deja lo que había o la lista vacía: nunca
  «cargando» para siempre; el siguiente cambio reintenta.
- El registro recuperado del `.bak` se avisa UNA vez por sesión (marca de módulo): llega en cada
  respuesta y la primera escritura dispara justo un `db:changed`.
- Sesiones: foto completa al montar y al recuperar el foco, más los cambios de `onSesion` (un
  cambio se puede perder si la ventana se recarga). Globales: el árbol casa por `conexionId`. Una
  cerrada se quita de la lista; una perdida se queda.

## Consecuencias

- Partir las dos listas en dos peticiones o dos estados reabre la poda equivocada. Una foto que
  llegue tras un cambio más nuevo lo pisa un instante: es el precio de no numerar los eventos.

## Descartes

- Dos peticiones (`list` y `ajenas`) fusionadas a mano: fallos parciales y dos lecturas del
  archivo que podían no coincidir.
