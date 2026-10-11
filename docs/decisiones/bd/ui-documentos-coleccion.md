# La pestaña de colección tiene tabla propia, panel JSON de texto y un «Enviar» que deja la política al main

- **Estado:** vigente
- **Ámbito:** `documentos/DbColeccionPane.tsx`, `documentos/TablaDocumentos.tsx` y sus hooks y funciones de pintado (`use*Coleccion.ts`, `edicionColeccion.tsx`, `vistaColeccion.tsx`, `envioDocs.ts`, `DialogosColeccion.tsx`)

## Contexto

La colección se ve como tabla de documentos con el documento elegido al lado y se edita por `_id`
(ver [ui-documentos-texto-y-cambios.md](ui-documentos-texto-y-cambios.md)). El main valida y decide
la política ([documentos-controlador.md](documentos-controlador.md)); aquí solo se pinta y se reenvía.

## Decisión

- **Tabla propia, no `DbRejilla`.** La rejilla es SQL de punta a punta (tipo por columna, clave
  primaria, «traer todas», DML de «Enviar»). En un documento el tipo va por celda, un campo puede
  faltar y un subdocumento se resume. Toma prestado el CSS de la rejilla y el ancho de columna sale
  del nombre y de las primeras filas, en `ch`, sin medir el DOM: no hay reflujo al desplazar.
- **El panel es un `<pre>` coloreado por el tokenizador** y un `<textarea>` al editar. Monaco
  sería otro editor vivo por pestaña (el keep-alive las monta todas), con la trampa de crearse a
  0 px en una oculta, para un texto que casi siempre solo se lee.
- **«Enviar» abre antes una vista previa**, como la rejilla SQL: una orden del shell por cambio
  (`envioDocs.ts`: `updateOne` con `$set`/`$unset`, `replaceOne`, `insertOne`, `deleteOne`, en el
  orden en que viajan y con el `_id` como lo enseña la tabla), el resumen por tipo y «Copiar». Es
  `DialogoEnvio` con `lenguaje="shell"` y su propio mensaje: «en UNA transacción si el servidor las
  admite», porque el de SQL mentiría en un servidor suelto. Las órdenes son para leerlas; lo que
  viaja son los cambios. Aceptarla en una conexión de producción (el botón ya dice «Ejecutar en
  producción») manda `confirmado`; si aun así el main devuelve `produccion` o `sinTransaccion`, se
  pregunta con foco en Cancelar y se reenvía con la confirmación de ese motivo.
- **Siempre editable.** La casilla «Solo lectura» de la conexión es de los agentes: no limita al
  usuario, y lo que el servidor no deje hacer lo dirá al enviar.
- **Con una proyección aplicada el documento es parcial:** reemplazarlo entero borraría los campos
  ocultos y ese botón no se ofrece (por celdas sí, va por `$set`). Una fila sin `_id` no se edita.
- **El siguiente clic en la cabecera parte de lo PEDIDO** (`pedidaRef`), no de lo aplicado: dos
  clics rápidos son asc → desc. Un fallo devuelve lo pedido a lo aplicado. Los campos con `$` o con
  un punto no se ofrecen en la barra guiada ni ordenan por la cabecera: para ellos está el modo JSON.
- **El estado y los efectos siguen el orden de un solo componente.** `DbColeccionPane` llama a los
  hooks en un orden fijo (consulta, edición, descarte, indicadores) y el resto son funciones que
  reciben su estado: sacar un efecto a un hijo cambiaría su orden respecto a los que se quedan.

## Consecuencias

«Abrir consola» en modo guiado abre `find({})`: el texto compilado del filtro vive en el main. Las columnas no se redimensionan a mano (descartado) y `FlechaOrdenDoc` copia la flecha privada de `rejilla/RejillaCabecera.tsx`.
