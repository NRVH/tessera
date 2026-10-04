# El esquema elegido en una consola se reaplica al abrir, y un lector queda atado al suyo

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/consolaSql.ts`, `sesiones/esquemaConsola.ts`, `sesiones/lectores.ts`, `sesiones/exportarConsulta.ts`, `controlador/consola.ts`, `controlador/estado.ts`

## Contexto

El selector de esquema vive en el índice de consolas y en memoria (`esquemaDe`), y tiene que
sobrevivir a reabrir la sesión, a un ROLLBACK de PG y a un corte de red. «Más», «Contar» y
exportar vuelven a ejecutar el TEXTO de una consulta, que se resuelve contra el esquema de AHORA.

## Decisión

- Al (re)abrir, el elegido se aplica ANTES de dar la sesión por abierta. Solo se OLVIDA ante la
  señal real de que no existe (ORA-01435; PG: `current_schema()` lo salta): una pérdida, un plazo
  o un error de red lo conservan (`trasReaplicarEsquema`), y al olvidarlo se avisa en la Salida.
- PG: `set_config('search_path', '"X", public', false)`, conservando `public` (las extensiones).
  Oracle: `ALTER SESSION SET CURRENT_SCHEMA`; `null` vuelve al de la apertura.
- En PG un ROLLBACK deshace un SET hecho dentro de la tx: se reaplica solo si la sesión estaba en
  el elegido ANTES (`reaplicarTrasTx`); un SET a mano del usuario MANDA.
- Cambiarlo: `esquemaDe` se fija ANTES de aplicar (una reapertura que se cuele ya ve el nuevo) y,
  mientras está en vuelo (`esquemaEnVuelo`), `recordarConsola` no copia el del índice. Si no se
  puede aplicar, la sesión y el mapa vuelven al ANTERIOR, no al de la conexión. El índice se
  guarda después; si falla, solo se registra. Uno a la vez por consola.
- Un lector nace con su esquema (`origen.esquema`): si cambió, «más» y «Contar» responden
  `noReleible` sin enviar nada. Exportar compara con el que vio el renderer solo si se conocen
  los dos (un falso positivo cae a exportar lo cargado, nunca a otra tabla).

## Consecuencias

- No se vuelve a fijar el mapa tras guardar el índice: deja un hueco en el que un ROLLBACK o una
  reapertura ven el valor viejo.
- Límite conocido: en PG el esquema es `current_schema()`, que aproxima el `search_path`.

## Descartes

- Degradar ante cualquier fallo: un corte de VPN borraba el esquema guardado para siempre.
- Reaplicar tras cada sentencia de clase `tx`: un BEGIN tras `SET search_path TO compras`
  volvía al elegido dentro de la transacción del usuario.
