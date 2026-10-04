# Abrir una tabla y «Enviar» apuntan su petición mientras el main la prepara, para que un Stop no se pierda

- **Estado:** vigente
- **Ámbito:** `controlador/tabla.ts` (`prepararDatos`), `controlador/archivosConsola.ts` (`cancelar`),
  `controlador/estado.ts` (`enPreparacion`)

## Contexto

Abrir una tabla y «Enviar» leen el catálogo (la clave primaria, la identidad de las filas) antes de
encolar nada en el gestor. Con la caché invalidada eso son uno o dos viajes por la VPN. Un Stop
que llegaba en ese tramo no encontraba cola que parar y se perdía en silencio: el envío llegaba
al COMMIT y la tabla se leía igual.

## Decisión

- Las dos operaciones se apuntan en `enPreparacion` (clave `conexionId|peticionId`, un conjunto de
  marcas por clave) mientras se preparan, y miran su marca (`detenido()`) justo antes de pasar la
  petición al gestor, **en el mismo turno** en que el gestor la encola. Desde ahí el Stop ya la
  encuentra en la cola.
- `cancelar` con rol `datos` marca las entradas de `enPreparacion` y además cancela en los gestores.
- Un conjunto por clave: dos peticiones con el mismo id se paran las dos, y la que termina no borra
  la marca de la otra. La entrada vive exactamente lo que dura la preparación.

## Consecuencias

No se puede meter un `await` entre la comprobación de `detenido()` y la llamada al gestor: el Stop
volvería a perderse. Un Stop que llega con la página ya leída no la tira (lo caro ya corrió).
Exportar se apunta con su propia marca: ver [sesiones-exportar-con-cursor-vivo.md](sesiones-exportar-con-cursor-vivo.md).

## Descartes

- Un marcador «`peticionId` cancelado» en el gestor, mirado al encolar: un Stop tardío (el caso
  normal de un clic que llega después) dejaría la marca huérfana y habría que caducarla.
