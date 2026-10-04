# La pestaña de clave lee con una petición cancelable, no se registra para descartar y no reutiliza la tabla de documentos

- **Estado:** vigente
- **Ámbito:** `claves/DbClavePane.tsx`, `claves/useLecturaClave.ts`, `claves/cuerpoClave.tsx`, `claves/TablaValores.tsx`

## Contexto

El visor de una clave es de solo lectura y su lógica de tablas y detalles vive en `visorClaves.ts`
(ver [ui-claves-visor.md](ui-claves-visor.md)). Esta decisión es la de la pestaña que lo pinta.

## Decisión

- **No se registra en `registroEdicion`:** al ser de lectura, cerrar la pestaña no tiene nada que
  perder. «Abrir consola» abre el comando de lectura del tipo y, si la clave es de otra base que
  la de la conexión, con `SELECT n` delante: se sigue desde donde se estaba mirando.
- **La lectura lleva `peticionId` y Stop la cancela** con el rol `datos`; el trabajador abandona la
  conexión, porque Redis no cancela un comando en el servidor. «Detener» está siempre en la barra y,
  si la lectura tarda, también en el cuerpo. Nada se pide hasta el primer `visible`.
- **El TTL se recalcula cada segundo solo mientras la pestaña se ve y la clave caduca;** una
  cuenta atrás con la pestaña oculta repintaría sin que nadie lo vea.
- **`noExiste` (borrada o caducada entre el SCAN y el visor) y un tipo que el visor no sabe leer**
  (lo añade un módulo) lo dicen y ofrecen «Abrir consola», en vez de una tabla vacía.
- **La tabla de elementos no reutiliza `TablaDocumentos`.** Sus celdas son de documentos (tipo por
  celda, campo ausente, edición) y sus columnas salen de los campos; aquí las columnas son fijas
  por tipo y las celdas son bytes. Se comparte el CSS y la ventana virtual (`useVentanaVirtual.ts`),
  no la lógica de celdas.
- Los textos no llevan nombres de producto ni de sistema: las guardias de motores sueltos y de
  nombres del sistema lo comprueban.

## Consecuencias

Editar desde el visor queda pendiente; se escribe por la consola.
