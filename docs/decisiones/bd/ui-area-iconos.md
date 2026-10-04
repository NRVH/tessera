# Los glifos de BD viven en un solo sitio y cada motor lleva un glifo propio salvo PostgreSQL, que lleva su logo sin tocar

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/iconosBd*.tsx`

## Contexto

El árbol, la tira de pestañas, las barras y los menús pintan los mismos conceptos. Declarados en
cada componente, el primer retoque deja dos «tabla» distintas en la misma ventana. Y la conexión
se reconoce mejor por la marca de su motor, pero esas marcas tienen dueño y reglas.

## Decisión

- Un solo módulo (`iconosBd.tsx`, que reexporta las familias de motores y de objetos), con un
  molde común: viewBox 24, trazo 1.6, `currentColor`, sin tamaño en línea. El nombre es el
  CONCEPTO (`IconoTabla`, `IconoEjecutar`), no el dibujo. El cilindro (`IconoBd`) usa el trazo
  1.7 del riel, para que la barra de actividad quede idéntica.
- El color por motor lo pone la clase `db-motor-<motor>` o un token `--db-marca-*`: valores y
  contrastes en [ui-arbol-colores-de-marca](ui-arbol-colores-de-marca.md).
- `MARCAS_MOTOR` es un `Record<DbMotor, …>`: un motor nuevo no compila sin su entrada. Uno
  desconocido (datos de una versión más nueva, o un id como «constructor») cae al cilindro: se
  decide con `esMotor`, que usa `hasOwnProperty`. El nombre del producto no vive aquí: es la
  `etiqueta` del descriptor, y `nombreMotor` queda como alias suyo.
- PostgreSQL: el elefante oficial de tres colores, tal cual y en sus colores en cualquier tema.
  Su política de marcas lo permite en una forma oficial, SIN MODIFICAR y sin sugerir aval; la
  atribución recomendada está en «Acerca de».
- Oracle: su logo y su «O Tag» (el anillo apaisado) exigen autorización escrita y prohíben la
  imitación. Glifo propio: el cilindro macizo en rojo, sin letras; lo que evoca es el color.
- SQL Server, MongoDB y Redis: glifos propios por el mismo criterio. SQLite: glifo propio
  provisional mientras no se compruebe la política de su logo.

## Consecuencias

Redibujar o recolorear el elefante incumple su política; imitar un logo restringido, la de los
demás. Redis y Oracle comparten rojo: los separa la forma, que no debe converger.

## Descartes

- Los iconos de `vscode-material-icons`: logos de color para tipos de archivo, que junto a los
  glifos de trazo hacían parecer el árbol de dos aplicaciones, y sin nada por motor.
