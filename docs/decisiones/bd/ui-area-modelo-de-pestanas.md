# Las pestañas de BD son un reducer puro propio, sin efímeras, con ids JSON de tuplas

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/dbTabsModel.ts`, `useAreaTira.ts`

## Contexto

La tira del área abre tablas, fuentes, DDL, consolas, colecciones y claves. Su identidad tiene
que ser estable aunque los nombres lleven `:`, `/`, `.` o espacios, y abrir una tabla no es gratis:
lanza un SELECT contra el servidor.

## Decisión

- Modelo PROPIO, no extraído del de pestañas del editor, cuyo test es la red que demuestra que el
  editor no cambia: un núcleo común irá en un cambio propio con ese test intacto.
- Sin pestañas efímeras: el porqué, en [ui-arbol-componente](ui-arbol-componente.md).
- Ids en JSON de tuplas, que no colisionan: `datos` sin el tipo (el mismo objeto desde dos sitios
  cae en la MISMA pestaña); `fuente` y `ddl` con tipo y firma (dos sobrecargas de PG son dos);
  `consola` por su id; `coleccion` con su base siempre; `clave` por los BYTES en base64 y la base
  (dos claves pueden pintarse igual; el nombre pintado solo titula).
- La base de SQL Server SÍ es identidad (`dbo.t` de dos bases son dos): entra en el id DETRÁS y
  solo si la hay, así que los ids de los demás motores no cambian. El entorno NO: se puede cambiar
  editando la conexión, así que viaja en el TÍTULO, que se resuelve al titular como el alias.
- Reordenar es `moverPestana(id, antesDe)`, sin desfase de uno, y no activa. Los cierres a cada
  lado se exponen como listas de ids para que el área pregunte a cada consola.
- Un indicador por pestaña por prioridad: ejecutando > cargando > transacción pendiente > sin
  enviar > sesión perdida > error. «Sin enviar» es propio: en la rejilla no hay transacción
  abierta y «Transacción pendiente» mentiría; los dos van en ámbar y los distingue la forma.
- `IndicadorPestana` vive aquí (el modelo no depende de un `.tsx`). `paneKeyDb` une perfil y
  pestaña con NUL escrito como escape (el byte crudo vuelve binario el archivo). Los no-ops
  devuelven el MISMO objeto.

## Consecuencias

Meter el entorno o el nombre pintado en el id cambiaría el de pestañas abiertas.

## Descartes

- Ids con separadores: un identificador entrecomillado puede contenerlos y colisionar.
