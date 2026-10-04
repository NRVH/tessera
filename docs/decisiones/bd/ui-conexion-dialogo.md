# El diálogo de conexión pinta lo que dice el descriptor del motor y el main sigue siendo la autoridad

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbConexionDialogo.tsx`, `DbConexion*.tsx`, `useConexionDialogo*.ts`, `dialogo.css`

## Contexto

Un formulario con un `if` por motor en el JSX olvida algún sitio con cada motor nuevo. Y el formulario
decide gestos que se pueden perder sin que se vea: un clic fuera, una contraseña a la vista, lo que se prueba.

## Decisión

- Campos, etiquetas, anchos, ayudas y tipos (`texto`, `puerto`, `eleccion`, `cifrado`, `casilla`) salen de
  `FormularioMotor` (`camposConexion.ts`); el diálogo traduce el `ancho` a `dbc-*`: un motor nuevo no trae JSX.
- Marcas: solo tras un intento de guardar (un formulario en rojo nada más abrirse riñe por lo que aún no se ha
  escrito), con las reglas del main (`camposAMarcar`); el foco va al primero y la marca se retira al corregir.
  El borrador se manda igual y el mensaje que se lee es el del main.
- Se prueba siempre lo GUARDADO: con cambios, el botón es «Guardar y probar», y tras él el diálogo sigue
  abierto editando lo guardado (contraseña otra vez «(sin cambios)»).
- El velo cierra solo sin cambios; Esc sí. La contraseña se re-oculta al cambiar de borrador; su ojo, `tabIndex -1`.
- Motor y entorno son controles NATIVOS (`<select>` con la marca del motor dentro de su caja; radios con
  aspecto de conmutador): teclado y lector de pantalla sin ARIA a mano.
- Motor de archivo: el destino es un selector (`CampoArchivo`) con la ficha del main, nunca una ruta. Con
  el certificado sin verificar, la prueba OFRECE «Confiar en el certificado y probar»; no se marca sola.
- «Pegar URI…» abre un campo que al rellenar se cierra y se vacía (lleva la contraseña); el foco vuelve al
  botón. La URI no se guarda, y el aviso de lo descartado dice «no se guardan», no «no se admiten»: en
  Redis se descarta todo lo que va tras el «?».

## Consecuencias

- Los clientes de base de datos: ver `ui-conexion-clientes.md`. Lo que viaja al main: `ui-conexion-borrador.md`.
- Partir el componente no puede cambiar de dueño ni de orden su estado ni sus efectos: la prueba tras
  «Confiar» lee `probar` del render que ya lleva la casilla.

## Descartes

- Un campo de URI siempre a la vista: parecería la fuente de verdad y se desincronizaría al tocar un campo.
- Un input de texto para la ruta del archivo: invita a escribir algo que el main no acepta.
- Un `<select>` para el entorno: el color de cada opción no cabe en un `<option>`.
- `container-type` en la tarjeta: implica `contain` y rompe un `position: fixed` de dentro.
