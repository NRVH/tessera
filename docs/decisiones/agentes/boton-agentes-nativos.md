# El botón de los agentes nativos nunca se deshabilita y su resultado es pegajoso

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/agentes/{BotonAgentesNativos.tsx,vistaBotonAgentes.ts,useActualizacionNativa.ts}`

## Contexto

El botón de la barra de título actualiza los CLIs nativos y reinicia sesiones de todos los perfiles,
también las que no se están viendo. Un botón gris con un punto encima anunciaba una noticia que el
usuario no podía abrir para leer.

## Decisión

- El botón siempre abre su popover; lo que se deshabilita es la acción de dentro, con el motivo al
  lado. La vista no tiene campo «deshabilitado». Son dos clics: abrir y confirmar, y la acción
  nombra lo que hará («Actualizar Codex y reiniciar 5 sesiones»).
- Precedencia del punto: en curso (anillo, sin punto) > error > ok sin ver > aviso. El error es
  PEGAJOSO hasta «Descartar»; el ok se retira al verlo; el aviso sólo con algún proyecto nativo
  abierto y sólo si hay algo que Tessera pueda instalar o reiniciar.
- Un resumen `abortado` (la compuerta paró antes de tocar nada) no pinta punto.
- El estado vive en `useActualizacionNativa`, montado desde App y no en el botón: cerrar el popover
  o desmontar la barra no puede tirar la noticia de una sesión que no volvió.
- El registro de panes es un `useRef<Map>` con `registrarApi` estable: en estado, cada montaje
  renderizaría App, y el orquestador lo lee en el momento.
- La salida de la instalación se acumula en un ref y se vuelca a ráfagas con tope de líneas.
- No lleva la clase `.boton-actualizacion`: el e2e del updater localiza su botón por ella.

## Consecuencias

- Añadir un estado deshabilitado o mover el resumen al popover reabre el fallo del punto mudo.
