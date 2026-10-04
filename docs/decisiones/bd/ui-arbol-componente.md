# El lateral de BD solo selecciona al clic, busca en lo cargado y reparte su render por un contexto con los efectos en orden fijo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/DbArbol*.ts(x)`, `FilaArbol*`, `arbolMenu.tsx`, `arbolTeclado.ts`, `useArbol{Estado,Filas,Desplazar}.ts`

## Contexto

El catálogo suele estar tras una VPN y cada gesto que consulta cuesta; el lateral se desmonta al
cambiar de vista. Filas: [ui-arbol-filas-y-carga](ui-arbol-filas-y-carga.md), [ui-arbol-nivel-bases](ui-arbol-nivel-bases.md), [ui-claves-arbol](ui-claves-arbol.md).

## Decisión

- **Dueños:** la vista es de `useDbVista`, el servidor de `cacheMetaBd` y lo efímero del lateral.
  `atendidas` es DE MÓDULO: con un ref, volver a la vista reabriría un diálogo ya atendido.
- **Clic simple solo selecciona**; doble clic, Enter, F4 (y ⌘↓ en Mac) abren una pestaña FIJA; un
  sinónimo abre su destino. El foco vive en el contenedor (`listbox` + `aria-activedescendant`): la
  lista virtual desmonta las filas fuera de la ventana y un foco en una fila se perdería al navegar.
- **Búsqueda al teclear:** filtra lo cargado y fuerza abiertos los antepasados sin tocar
  `expandidos`; al cerrarla se despliega de verdad solo el camino a la selección.
- **Mayús+F10 y la tecla Menú no se cancelan:** generan el `contextmenu`, que abre el de la fila
  seleccionada anclado a ella ([atajos-por-plataforma](../renderer/atajos-por-plataforma.md)).
- **Lo destructivo confirma y dice lo que se pierde** (montajes, consolas a la papelera, cambios
  sin confirmar o sin enviar). Con una transacción pendiente se pregunta Confirmar / Revertir /
  Cancelar, con el foco en Cancelar; «Desconectar» de la cabecera sigue la regla del menú.
- **Entorno:** franja de su color al borde y, en producción, la fila teñida (nombre en el tooltip).
  Un archivo soltado abre el alta PRECARGADA, nunca a ciegas ([conexiones-archivos-de-base-de-datos](conexiones-archivos-de-base-de-datos.md)).
- **Partición:** cada render arma un `CtxArbol` que reciben las funciones de módulo (acciones,
  menú y contenido por TABLA de `kind`, teclado por reglas en orden). Los efectos van en hooks del
  mismo componente en orden fijo, y un `useState` con efecto propio se declara junto a él.

## Consecuencias

Reordenar los hooks de `DbArbol` cambia el orden de los efectos ([estado-de-app](../renderer/estado-de-app.md)).
`DbArbol.tsx` y `DbArbolDialogos.tsx` están en el ciclo de importación: nada que lea el ciclo al cargar.

## Descartes

- Pestañas efímeras al clic: recorrer el árbol con el ratón lanzaba una consulta por fila.
- El chip del entorno en la fila: con el lateral a 260 px dejaba el alias en cuatro letras.
- La barra de búsqueda superpuesta a las filas: tapaba justo la primera coincidencia.
