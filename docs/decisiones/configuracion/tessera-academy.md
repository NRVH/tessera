# La ayuda es Tessera Academy: artículos por concepto en una categoría de Configuración, con un ⓘ en cada diálogo complejo

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/academy/`, `features/ajustes/catalogo.ts` (`conAcademy`), `SettingsModal.tsx`, `features/layout/CapaModales.tsx`, `comun/ConfirmDialog.tsx` (`ayuda`)

## Contexto

Los tooltips y las ayudas de una línea no alcanzan para explicar conceptos que atraviesan la app
(perfil, cuenta, nativo o Docker, hibernar, montar, traspaso). Alargarlos empeora cada pantalla; una
ayuda fuera de la app se desfasa y no se encuentra desde el diálogo que la necesita.

## Decisión

- Una categoría más de Configuración, «Tessera Academy», justo antes de «Acerca de». Sus filas para
  el buscador son los artículos (título y palabras en los dos idiomas), así que el buscador de
  Configuración encuentra un artículo igual que un ajuste. La categoría no vive en `CATEGORIAS`: la
  añade `conAcademy` al montar el modal, para que el catálogo no importe de otra feature y su test
  siga viendo solo ajustes.
- `features/academy` no depende de ninguna feature. El índice (`indice.ts`) fija el orden y los
  grupos; cada artículo es un `contenido/*.ts` con `crearTextos(es, en)` y la forma de `modelo.ts`:
  secciones con ancla y bloques (párrafo, lista, pasos, nota, captura), cualquiera de ellos limitado
  a unas plataformas con `soloEn`.
- Marcado propio y mínimo (`marcado.ts`): negrita, código, enlace a «articulo/ancla» y los nombres
  del sistema entre llaves, que salen de `nombresSistema`. Se pinta sin HTML crudo; los enlaces del
  glosario llevan su definición en el `title`.
- La categoría es solo el índice: una rejilla de tarjetas por grupo, a todo el ancho. Cada artículo
  se lee en su propio modal, el lector (`LectorAcademy`, en la capa de modales de la raíz y un nivel
  de z-index por encima, `modal-encima`): cabecera con su icono, índice de secciones fijo que marca
  la que se lee (en un lector estrecho pasa arriba como pastillas), cuerpo con scroll y, en un pie
  fijo, el paso al anterior y al siguiente, alcanzable desde cualquier punto del artículo. Esc lo
  cierra y se vuelve a lo de debajo. Sus migajas llevan al índice: «Tessera Academy», al principio, y
  el grupo, a ese grupo resaltado un momento. Las atiende Configuración (`ModalAjustes`), que es quien
  depende de Academy, por un contador del store de Academy (`irAlIndice`). Los atajos entre comillas
  invertidas se pintan como teclas.
- El botón ⓘ (`BotonAyuda`) va junto al título de un diálogo o popover y abre el lector en la
  sección que lo explica, sin abrir Configuración: el diálogo se queda debajo, intacto, y un
  popover se cierra. Los destinos viven juntos en `ayudas.ts`. El Enter de `ConfirmDialog` no
  confirma si viene de otro diálogo.
- Abrir un artículo es un pedido al store de la Academy (`pedido`), que el lector escucha también
  para volver a llevar a la sección aunque ya fuera la misma.
- Las capturas son `academy/capturas/<id>.<idioma>.webp`, generadas con datos de ejemplo por
  `npm run capturas:academy` (el mismo guion que las del README, una pasada por idioma, pasadas a
  WebP y a 1200 px de ancho como mucho para no engordar el instalador). Se hacen en Windows: en
  otra plataforma se ve la ventana de Windows, y es el único texto que no sale de `nombresSistema`.

## Consecuencias

- `test-academy.mts` exige que el inglés tenga la misma forma que el español, que todo enlace y todo
  ⓘ lleguen a un artículo y una sección que existen, solo nombres del sistema conocidos, sin
  «Windows» o «macOS» fuera de un bloque `soloEn`, el vocabulario de la app (hibernar, nunca
  dormir) y que ningún artículo se llame como un ajuste.
- La negrita es para citar etiquetas: cada una tiene que existir tal cual en algún `textos*.ts` de
  la interfaz (con su parte variable si es una plantilla), así que renombrar un botón rompe la
  prueba hasta que su artículo lo diga igual. Las pocas negritas que no son etiquetas van en una
  lista de excepciones del test.
- La ventana de agente no monta la capa de modales: un ⓘ allí no tendría dónde abrirse, y no se pone.

## Descartes

- Ayuda en la web: no se ve desde el diálogo que la necesita y se separa de la versión instalada.
- Tooltips largos: tapan la pantalla y no se pueden enlazar entre sí.
- Markdown con HTML: obliga a sanear y deja pasar texto que nadie revisó en los dos idiomas.
- Leer el artículo dentro del panel de Configuración: la columna es estrecha para leer, y abrirlo
  desde un ⓘ obligaba a cambiar de categoría, desmontando lo que el panel anterior tuviera abierto.
