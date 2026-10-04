# La actualización de la app se cuenta igual en las dos plataformas y un aviso solo se retira donde se lee

- **Estado:** vigente
- **Ámbito:** `features/actualizaciones/` (botón de la barra de título) y `features/ajustes/categorias/Actualizaciones.tsx` con `categorias/bloquesUpdate/`

## Contexto

Windows y macOS comparten el ciclo buscar, descargar e instalar (en macOS lo aplica el relevo propio,
`main/update/relevoMac.ts`). El botón de la barra y la categoría de Configuración pintan el mismo
`UpdateState`, y no pueden contradecirse.

## Decisión

- Ningún componente ni módulo de vista lee la plataforma: `available` ya dice que ESTA COPIA no puede
  dar el último paso (no se sabe dónde está el `.app`, su carpeta no es escribible o el feed no publica
  un `.zip` con sha512). Es un estado, no una capacidad: se ofrece «Descargar X» y no se esconde nada.
  La fila «Aplicar al cerrar» solo se esconde donde `autoInstalarUpdate` es `false`, y esa puerta está
  en el catálogo (`AJUSTES_POR_CAPACIDAD`): si el componente mirase la plataforma, el buscador de
  ajustes, que no pasa por él, seguiría contando la fila.
- `avisoAplicada` y `avisoFallo` no se auto-cierran por temporizador. En el popover, cerrarlo con
  `avisoAplicada` delante lo descarta (`debeDescartarAlCerrar`): tenerlo abierto ya es leerlo. `avisoFallo`
  pide algo y conserva su «Descartar».
- En Configuración NO hay descarte por desmontaje: el desmontaje no distingue «el usuario se fue» de
  «React recolocó el árbol». El buscador cambia el subárbol de la categoría por el de resultados al teclear
  una letra, y esta pantalla pinta solo el fallo cuando hay los dos avisos. Allí el gesto es el botón.
- `avisoAplicada` va por encima de `checking` en `decidirVistaUpdate`, y de nada más: si no, el chequeo de
  los 8 s tras arrancar apaga el punto y deshabilita el botón que abre la noticia.
- El grupo «Agentes» comparte el estado del hook de App y no duplica la confirmación: «Actualizar…» cierra
  el modal y abre el panel del botón; dos listas de sesiones acabarían diciendo cosas distintas.
- El selector de escenas de desarrollo se decide con `import.meta.env.DEV`, no con `status === 'disabled'`:
  con `TESSERA_FAKE_UPDATE` el estado deja de ser `disabled` y el selector debe seguir visible.

## Consecuencias

- No colgar un descarte del desmontaje de la categoría, ni condicionar por plataforma dentro de estos
  componentes. `vistaUpdate.ts` se mantiene puro para que `test-vista-update.mts` recorra los estados
  de las dos plataformas.
