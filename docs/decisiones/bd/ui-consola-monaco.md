# Las marcas de la consola viven en el modelo, con tres dueños de marcadores y lenguajes propios

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/consola/` (`monacoConsola`, `validadorAvisos`, `marcasConsola`, `lenguajeConsola`)

## Contexto

Monaco no carga bajo `node`: lo que decide va a módulos puros y el adaptador solo pinta. El
modelo nace al montar el pane y el editor en su primer `visible`.

## Decisión

- **Decoraciones sobre el MODELO** (`deltaDecorations`), cuatro por sentencia: el rango vivo
  (`NeverGrowsWhenTypingAtEdges`, del que parten «ir a la posición» y el error), el glifo en el
  primer carácter, el tinte de «corriendo» y el tiempo al final de la última línea.
- **Editar dentro de una sentencia quita su marca**; los bordes no. El cronómetro repinta solo la
  que corre, cada 250 ms: vacío el primer segundo y luego segundos enteros.
- **Tabla de marcas**: barra solo en lo que llegó al servidor; en un error, el código sustituye
  al tiempo; «compiló con avisos» es una ✓ ámbar; un plan lleva su glifo y nunca barra. Una sola
  forma de escribir una duración (`formatoDuracion`: «671 ms», «2 s 270 ms»).
- **Tres dueños de marcadores** (compartir uno haría que el recálculo de uno borrara al otro):
  ejecución (✗ del servidor y compilación), avisos léxicos (250 ms tras teclear, hasta 2 MiB) y
  sintaxis (asíncrona desde el main; una respuesta vieja no pinta, `peticionSintaxis`).
- **Lenguajes propios** para Oracle (q-quote) y SQLite, DERIVADOS del `sql` de Monaco, porque
  `sql` es también el de los `.sql` de cualquier motor. Monarch baja a minúsculas el `$1` del nombre
  de estado y parte por puntos: hay un estado por carácter ASCII y el genérico cierra con `~`.
  Límite aceptado: con una LETRA de delimitador, el cierre no distingue caja.
- **Registro SÍNCRONO e idempotente** (`WeakSet` por instancia): el primer pintado ya lo ve.
  Atajos con `addAction`, uno por editor (`addCommand` se lo quedaba el último editor creado).

## Consecuencias

- Un motor con lenguaje de consola propio se registra en `lenguajeConsola.ts` o sale sin color.

## Descartes

- Decoraciones sobre el editor: un lote lanzado sin editor se quedaba sin glifos.
- Mover la marca con la edición: una ✗ apuntando a un texto que ya no falló es peor que ninguna.
- Parchear el `sql` de Monaco o `next: '@q.$1'` con `==`: pisa otros motores o no cierra nunca;
  tiempos en `toFixed(2) s`: obliga a convertir de cabeza y choca con la coma decimal.
