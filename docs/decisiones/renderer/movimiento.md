# El movimiento de la interfaz: unas pocas duraciones y curvas, y seis patrones

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/comun/movimiento.css`, `comun/presencia.ts`, `comun/Presente.tsx` (`Presente`, `Cruce`),
  `comun/useMovimientoContexto.ts`, `comun/useConfirmacionCopiar.ts`, las insignias (`Insignia` de `comun/Presente.tsx`),
  `features/layout/movimientoLayout.ts`, `App.tsx`,
  `comun/BotonGuardar.tsx` y `comun/BotonDescartar.tsx` (con `botonGuardar.css`),
  `features/layout/useLayoutConTransicion.ts`, `features/layout/useVistaFranjaConTransicion.ts`, `features/layout/franjaDesacoplada.ts` y toda hoja que anime algo

## Contexto

Sin un criterio común, lo que aparece y desaparece cambia de golpe: avisos que empujan el contenido, popovers y menús
que surgen y se van en seco, modales que entran con suavidad pero se cierran de golpe. Y lo que sí se mueve acaba con
una duración distinta escrita a mano en cada hoja, cada una obligada a acordarse de «reducir movimiento».

## Decisión

- **Variables en `movimiento.css`**, cargada en la principal, las ventanas de agente y las franjas desacopladas: `--mov-rapido` (120 ms; pasar el ratón,
  seleccionar, colores), `--mov-medio` (180 ms; aparecer y desaparecer), `--mov-entrada` (240 ms; paneles y bloques),
  `--mov-salida` (140 ms; lo que se va, antes que lo que entra), `--mov-confirma` (420 ms; la confirmación con
  rebote), `--mov-giro` (800 ms; indicador de recarga), y `--mov-cromo-aparece` (180 ms) y `--mov-cromo-retira` (350 ms) para las acciones de la cabecera de un
  panel, que aparecen rápido y se retiran despacio, como los controles de un reproductor. Curvas:
  `--curva-estandar` (ease, color y opacidad), `--curva-lineal` (giro continuo), `--curva-entrada` (desacelera al llegar), `--curva-expandir` (alto y
  ancho) y `--curva-rebote` (solo confirmaciones). Lo que se mueve usa estas variables, no valores propios.
- **«Reducir movimiento» se respeta en un solo sitio**: con él, las duraciones valen cero. Una hoja solo añade su
  propio bloque si además quita un recorrido o una animación con keyframes.
- **Seis patrones**, siempre los mismos:
  1. **Aparecer** (`.mov-aparece`, con `Presente` o `usePresencia`): fundido desde un pequeño desplazamiento o escala,
     y salida con el gesto inverso, más corta. Variantes: desde la derecha para un panel lateral, desde arriba para un
     menú que cuelga de su botón.
  2. **Desplegar** (`.mov-despliega`): un aviso o un bloque que entra en el flujo crece desde alto cero, en vez de
     empujar lo de abajo de golpe (`interpolate-size`).
  3. **Cruce** (`Cruce`): un contenido sustituye a otro con un fundido cruzado en la misma celda, sin cambiar de tamaño
     («Probando…» → resultado, «Cargando…» → lista).
  4. **Confirmación en el control** (`BotonGuardar`): el éxito lo dice el propio botón, con una palomita que rebota y
     vuelve sola; nunca un texto suelto al lado. Copiar confirma una escritura completada con `IconoCopiar copiado` y su
     palomita (`.git-copiado`), conservando el tamaño y la etiqueta del control; sin toast de éxito. Un aviso de copia
     recortada o de error conserva su significado y se muestra una sola vez.
  5. **Siempre montado** (`BotonDescartar`): un control que aparece según el estado está siempre en su sitio y entra o
     sale con un fundido; no se monta ni se desmonta, y no mueve a sus vecinos.
  6. **Estado suave**: fondo, color y borde cambian en `--mov-rapido` al pasar el ratón, seleccionar o deshabilitar.
- **La interfaz principal va primero.** Abrir un archivo o una pestaña, cambiar de vista, mostrar u ocultar un panel
  (la franja de terminales, la columna del agente, el historial de git) es lo que más se usa.
  Los paneles que se ocultan sin desmontarse, cuando no cambian el reparto, entran con un fundido y un desplazamiento
  corto desde su lado, por una animación que solo aplica mientras se ven; si lo cambian, su entrada es la de la
  transición del reparto. No se anima su tamaño, que obligaría a la terminal y al editor a recolocarse en cada fotograma. Al ocultarse desaparecen al momento: un panel que se funde sigue ocupando su sitio,
  empuja a los demás y su terminal se comprime mientras dura.
- **El contexto incluye el perfil y el proyecto activos.** Cambiar cualquiera de ellos es instantáneo: sin transición
  de reparto, entrada de paneles ni fundido del contenido, incluido el riel SSH, el agente y el editor. Dentro del mismo perfil y proyecto, cambiar de agente o
  abrir otro archivo conserva el fundido corto. Una transición de reparto pendiente se salta al cambiar de contexto.
- **Las insignias** aparecen y salen con `Presente`, `mov-aparece` y una escala pequeña; retienen el último conteo
  durante la salida. Cambiar un conteo visible no vuelve a animar su entrada.
- **Cambiar de vista con el riel (Archivos, Git, Bases de datos) no mueve el reparto.** El reparto de la ventana no
  viaja y el contenido del lateral solo se funde en su sitio (`--mov-rapido`): es un cambio que se repite sin parar, y
  con desplazamiento cada vista tardaría en quedar lista.
- **Lo que trae un diálogo al abrirse aparece con él** (`useAbriendo`): mientras la tarjeta entra, los campos que se
  despliegan no hacen su propia entrada; si la hicieran, el diálogo crecería campo a campo mientras se abre.
- **Cambiar de agente es un conmutador.** La cabecera con sus pestañas y el pie se quedan quietos y solo el contenido
  del agente se funde, sin desplazarse: si entrara el panel entero, parecería que se vuelve a abrir la columna.
- **El reparto de la ventana, cuando aparece una zona** (abrir la franja, mostrar la columna del agente, el primer
  archivo que encoge al agente, la terminal que aparta al agente a pantalla completa), cambia dentro de una
  transición de vista del navegador (`useLayoutConTransicion`, sobre el layout del centro, que es el único
  sitio del que sale el reparto). Se captura el reparto anterior, se aplica el nuevo de una vez y cada zona
  viaja a su sitio y su tamaño nuevos; la captura se recorta, no se escala. La zona que aparece (`zonasQueAparecen`)
  entra por su lado con el contenido a la vista: la terminal y Git suben desde abajo, recortadas contra su borde
  inferior, y la columna del agente llega por la derecha. Lo decide el layout y no el tamaño porque a pantalla completa
  la columna tiene caja detrás de la terminal. El pie del agente lleva su propio nombre y acompaña al borde. La zona que
  encoge enseña su captura vieja, que tiene contenido hasta el borde que se mueve, y la nueva entra encima al final
  (`conservaCaptura`); una zona con terminal que cambia de ancho hace lo mismo también al crecer, porque su texto se
  está volviendo a partir mientras tanto. La captura nueva está viva, así que el texto recolocado ya está listo cuando
  se ve y el contenido no llega a desaparecer. Si el texto de las dos capturas es distinto (`cambiaElTexto`, una terminal
  que se reparte o enseña otras líneas) no hay fundido: el nuevo sustituye al viejo al terminar, porque encimados no se
  leen y uno tras otro parpadea la zona entera. Animar el tamaño de verdad obligaría a la terminal (con su pty) y al
  editor a recolocarse en cada fotograma, y una terminal que cambia de tamaño varias veces seguidas deja la salida del
  shell descolocada. **Maximizar o restaurar la franja** es el mismo reparto (`cambioDeReparto`): solo se mueve ella,
  que crece o encoge por encima de lo demás, y lo que va a tapar sigue a la vista hasta que llega; ocultarla maximizada la
  saca por abajo y volver a abrirla la trae por abajo, ya a pantalla completa. Con el agente de la terminal al lado, la
  franja y su columna entran y salen juntas, como un solo bloque; mostrar u ocultar solo el agente lo mueve por la derecha.
  Lo que enseña la columna cambia con el reparto, no antes (`RepartoVisto.columna`): se vería el agente equivocado. Al
  pasar la terminal visible entre su tamaño normal y maximizada, todo es un solo gesto: la lista de conexiones se abre por
  la izquierda desplazando el texto y el agente por la derecha, recortados por el borde que sube o baja (`morfa`). Mientras dura (240 ms) la ventana no recibe clics. En el mosaico no se anima. **Cerrar una zona es
  el mismo gesto a la inversa, en 200 ms**: la que se va (`zonasQueSeVan`, que lo deduce del cambio de reparto) lleva
  su propio nombre solo en la captura vieja y sale por su lado; la que no tiene lado (el editor, las bases de datos) se
  funde en su sitio. Lo decide el layout y no el DOM porque la columna del agente sigue en la página cuando se cierra
  el de la terminal: con el mismo nombre, se encogería enseñando el contenido nuevo (la cabecera del agente del proyecto). El contenido que
  se abre (un archivo, un diff, otro modo, otra rama) dentro del mismo contexto entra con un fundido corto; lo que el usuario escribe nunca se
  anima. El texto de un diff espera invisible a su primer cálculo y a su plegado, con un tope, y entra con un solo fundido.
- **La ventana desacoplada de la franja anima sus cambios de vista con el mismo gesto, en su propio documento**
  (`useVistaFranjaConTransicion`): la transición, las capturas, las clases de `<html>` y la decisión de «reducir
  movimiento» son las de esa ventana, no las de la principal, que puede estar tapada o en segundo plano. Pedir la vista
  compacta o la completa, mostrar u ocultar el agente y cambiar entre Terminal y Git·Log pasan por ella. La barra lateral
  y la columna del agente salen y entran por su lado, y el pie del agente acompaña a su columna. La lista de
  conexiones SSH se abre y se cierra con el texto de la terminal (`morfa`), no se queda en una captura hasta
  desaparecer al final. Terminal y Git·Log ocupan el mismo hueco: el nuevo se funde sobre el viejo, que sigue opaco
  debajo (`transicion-cruce`, también en la principal cuando se turnan maximizados y no cambia nada más del reparto
  (`cambioDeReparto`); dos fundidos a la vez dejarían ver el fondo). Que el ancho de la ventana imponga o retire
  la vista compacta no se anima, porque es redimensionar. Cambiar de proyecto tampoco anima el reparto.
  El foco del panel nuevo se pide cuando ya se ve.
- **Las acciones de la cabecera de un panel**, que se retiran en reposo, se pliegan del todo en vez de dejar su
  hueco, y al pasar el ratón se despliegan hacia la izquierda. La cabecera del agente no se retira: es la columna con
  la que se trabaja todo el tiempo, y sus acciones aparecerían y desaparecerían cada vez que el ratón entra o sale.
- **Cerrar u ocultar el agente de la terminal es un cierre**: aunque la terminal que tapaba vuelva a verse, se
  funde como cualquier cierre, con la columna marcada como la zona que se va.
- **El contrato se prueba con las animaciones encendidas** (`e2e/movimiento.spec.ts`): el resto de specs las
  apagan para ser estables, así que solo ese caza una regresión de movimiento. Corre en cada cambio que toque la
  interfaz, el layout o el CSS.
- **Lo que se cierra desmontándose** (modales, menús, popovers, tooltips) deja una copia inerte que hace su salida y
  se borra (`despedida.ts`): quien lo cierra no cambia nada.
- **Entradas con `@starting-style`, salidas con presencia.** Entrar es CSS puro. Salir exige que el elemento siga
  montado mientras se va: `usePresencia` lo deja montado lo que dura la salida, marcado con `data-saliendo`.
- **Lo que no se anima, a propósito**: escribir, la terminal y el contenido de Monaco, el desplazamiento, arrastrar,
  redimensionar, filtrar mientras se teclea, y la entrada de filas de las listas grandes (árbol de archivos, historial
  de git, resultados de búsqueda): la selección sí cambia con estado suave, que es una sola propiedad.

## Consecuencias

- `test:presencia` fija que lo que deja de verse sigue montado mientras sale y que lo que vuelve a pedirse a tiempo
  cancela la salida.
- Una animación nueva elige uno de los seis patrones; si no encaja ninguno, se añade aquí antes de inventar otro.
- Las pruebas de interfaz corren con «reducir movimiento» emulado en cada ventana (`e2e/tessera.ts`): miden la
  interfaz quieta y no encuentran la copia de salida de un menú. Un spec que pruebe el movimiento lo pide con
  `conMovimiento`. Un control siempre montado se comprueba como oculto, no como ausente.

## Descartes

- **Una biblioteca de animación de terceros**: añade peso y su propio modelo para lo que CSS ya hace
  con `@starting-style`, `interpolate-size` y transiciones; solo hace falta retrasar el desmontaje, que son veinte
  líneas.
- **Animar con JavaScript cada fotograma**: compite con la terminal y el editor por el hilo principal.
