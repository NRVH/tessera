# Los proyectos de un perfil se reordenan arrastrando su pestaña: soltar encima ocupa su sitio

- **Estado:** vigente
- **Ámbito:** `features/pestanas/useArrastreProyectos.ts`, `ProjectTabs.tsx`, `reducirReordenarProyectos`, `util/reorderByDrag.ts` (`ladoDeSoltar`) y `.project-tab`

## Contexto

El orden de las pestañas de proyecto ES `openProjects`, y ya se guarda y se restaura tal cual. De él
salen el vecino que hereda al cerrar, el orden del mosaico y el del buscador. Por la ventana viajan
otros arrastres (archivos del explorador, pestañas de BD) y las terminales aceptan lo que se les
suelte encima.

## Decisión

- La misma regla que los perfiles (`reorderByDrag`): soltar una pestaña sobre otra la deja en su
  sitio. La raya se pinta del lado que dice `ladoDeSoltar`, que sale de esa misma regla.
- El arrastre lleva un tipo propio, en minúsculas, y como dato una marca: nunca `text/plain` ni la
  ruta, que vive en un ref y no sale de la ventana. Solo se acepta lo propio, con `stopPropagation`.
- El gesto captura el perfil al empezar y no se aplica si al soltar el activo es otro. Se limpia
  también desde la ventana (`dragend`/`drop`): la pestaña que viaja puede desmontarse a medio gesto.
- El reductor exige EXACTAMENTE las rutas abiertas del perfil, reutiliza los mismos `OpenProject`
  y devuelve el mismo state si nada cambia. Solo toca `openProjects`: arrastrar no activa ni
  despierta, ni vuelve a confirmar el objetivo del backend.
- En reposo no cambia nada: `draggable` solo con dos proyectos o más, y las clases y el
  `position: relative` de la raya solo existen durante el gesto.
- El mismo arrastre en las dos plataformas: la banda está fuera de `-webkit-app-region: drag`.

## Consecuencias

- Los panes vivos (agente y terminales) se montan en orden ESTABLE, por clave (`util/ordenEstable`),
  y no en el de las pestañas: un nodo que React cambia de sitio pierde su scroll, y la terminal
  saltaría al principio del historial. El e2e fija que ni se remontan ni cambian de sitio.
- Relajar el reductor o clonar los proyectos reabriría sesiones o guardaría un proyecto duplicado.
- No hay alternativa de teclado ni de menú para reordenar, ni arrastre entre perfiles.

## Descartes

- La raya por mitades de la tira de BD: es otra regla, y aquí el gesto es el de los perfiles.
- Activar al arrastrar: re-apuntaría el explorador, git y la terminal por mover una pestaña.
