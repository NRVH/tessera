# Filtros del Log: la rama va al backend, el resto se filtra en cliente y los padres se reescriben aquí

- **Estado:** vigente
- **Ámbito:** `features/git/modelo/filtrosLog.ts`, `reescribirPadres.ts`, `graphLayout.ts`

## Contexto

El layout del grafo exige una lista cerrada bajo ancestros. Al filtrar por usuario, fecha o
texto quedan commits ocultos entre dos visibles y el layout abre lanes que nunca cierran: el
grafo se vuelve un peine de líneas verticales sin nodos. Se midió que `git log --parents` no
reescribe los padres con `--author` ni `--grep` (solo lo hace con filtros por ruta).

## Decisión

- La RAMA se resuelve en el backend (`git log <rama>`), el único filtro que devuelve un
  conjunto cerrado bajo ancestros. Usuario, fecha y texto se aplican en el cliente sobre la
  página cargada, y la UI avisa de que solo mira lo cargado y ofrece cargar todo.
- `reescribirPadres` apunta cada padre oculto a su ancestro visible más cercano (DFS
  iterativo con memo, sin recursión: decenas de miles de commits) y marca la arista SALTADA.
- La marca viaja con el LANE, no solo con la arista de salida: la línea entera se pinta
  punteada. Marcar solo la salida dejaba líneas mitad sólidas mitad punteadas, que se leían
  como un fallo de render.
- `aplicarFiltros` devuelve la MISMA referencia si no hay nada que filtrar: de eso dependen
  el cortocircuito de `reescribirPadres` y el memo del layout.
- Un texto de 6 o más hex se trata como hash, pero filtra por prefijo O texto: un número de
  ticket o «decade» también lo cumplen y un «no hay resultados» sería falso.

## Consecuencias

- Filtrar no toca git: cero procesos por tecla (caro en Windows).
- Un filtro nuevo de cliente entra en `aplicarFiltros`; uno que el backend pueda resolver
  sin romper el grafo, solo si devuelve un conjunto cerrado.

## Descartes

- Llevar autor, fecha y texto a `git log --author/--since/--grep`: no arregla el grafo,
  cuesta un proceso por tecla y multiplica los ejes de la caché hasta hacerla inútil.
