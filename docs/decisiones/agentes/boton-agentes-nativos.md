# El botón de los agentes nativos nunca se deshabilita y su resultado es pegajoso

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/agentes/{BotonAgentesNativos.tsx,vistaBotonAgentes.ts,useActualizacionNativa.ts,SeccionActualizacionDocker.tsx,storeActualizacionDocker.ts,modeloActualizacionDocker.ts}`, `src/main/sandbox/{actualizarImagenAgentes.ts,estadoImagenAgentes.ts}`

## Contexto

El botón de la barra de título actualiza los CLIs nativos y reinicia sesiones de todos los perfiles,
también las que no se están viendo. Un botón gris con un punto encima anunciaba una noticia que el
usuario no podía abrir para leer.

## Decisión

- **Un solo botón para todos los agentes**, los del equipo y los de Docker: las pestañas de Docker pueden estar ocultas,
  y el botón no puede depender de ellas. Docker es una sola sección porque todas las cuentas de todos los perfiles usan
  la misma imagen, y cada sección se actualiza por su lado; si Docker falla, la del equipo termina igual. **Actualizar
  todo** solo aparece con novedades en las dos.
- Actualizar Docker detiene todos sus contenedores: si hay agentes trabajando o esperando respuesta, o tareas delegadas en
  marcha, los enumera y se confirma en el mismo botón, con datos frescos. Las tareas se paran antes con su motivo y se
  pueden reanudar. Con Docker apagado no se enciende solo para revisar.
- Las acciones de cada sección llevan el contorno del perfil y solo **Actualizar todo** va relleno.
- El botón siempre abre su popover; lo que se deshabilita es la acción de dentro, con el motivo al
  lado. La vista no tiene campo «deshabilitado». Son dos clics: abrir y confirmar, y la acción
  nombra lo que hará («Actualizar Codex y reiniciar 5 sesiones»).
- Precedencia del punto: en curso (anillo, sin punto) > error > ok sin ver > aviso. El error es
  PEGAJOSO hasta «Descartar»; el ok se retira al verlo; el aviso sólo con algún agente nativo
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
