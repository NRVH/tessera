# Configuración es un modal con un riel de categorías, y su buscador atraviesa todas las categorías

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/ajustes/` (`SettingsModal.tsx`, `catalogo.ts`, `filtrarAjustes.ts`, `primitivas.tsx`, `categorias/`)

## Contexto

Los ajustes crecen con cada función. Una columna lateral es demasiado estrecha para ellos y obliga a
un desplazamiento largo; con categorías, un ajuste que casa una búsqueda puede estar en una que no se
ve.

## Decisión

- Un modal con riel de categorías (se abre con el engranaje de la barra de título o `Mod+,`). Una
  sola puerta: no hay panel lateral de ajustes, así que abrirlo no desmonta la vista de debajo ni
  perturba el keep-alive de las sesiones.
- Ninguna categoría vacía: una entrada que abre un panel en blanco se lee como un fallo. Añadir una
  cuesta una entrada en `catalogo.ts`, un componente y un icono, y el compilador lo exige (`PANELES`
  e `ICONOS` son `Record` completos de `CategoriaId`). Tres niveles: categoría, grupo, fila.
- Mientras hay texto en el buscador, el panel enseña los resultados de TODAS las categorías, cada
  bloque con su nombre (sin él, dos filas «Tamaño» no se distinguen), y el riel se vuelve un índice
  con el número de coincidencias. Borrar el texto vuelve a la categoría elegida.
- El motor de búsqueda trabaja sobre una lista plana de grupos con título «Categoría Grupo» (solo
  pajar, nunca se pinta) y sinónimos declarados en el catálogo. Su test valida el catálogo real.
- La puerta por plataforma o capacidad va en el CATÁLOGO (`categoriasVisibles`), nunca en el panel:
  el buscador cuenta sobre el catálogo y anunciaría coincidencias que el panel no enseña.
- La herencia se lee en el propio control: un tamaño que hereda enseña el efectivo con «Igual que la
  interfaz»; tocarlo fija uno propio y aparece el botón de volver, cuyo hueco se reserva con
  `visibility` para que el control no salte al aparecer.
- Interfaz, terminal de shell y terminal del agente tienen apariencias independientes; un archivo de
  ajustes que solo trae la de la terminal siembra la del agente con esos valores, para no cambiar sola
  la fuente de quien la tenía ajustada.

## Descartes

- Filtrar solo en la categoría abierta: esconde la mitad de las coincidencias.
- Saltar sola a la primera categoría con resultados: mueve el suelo mientras se teclea.
- Un desplegable «igual / propio» por fila: duplica lo que el control ya dice.
