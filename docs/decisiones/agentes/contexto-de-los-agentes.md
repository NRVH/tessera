# El contexto de los agentes se organiza por lo que es (reglas, documentos, configuración) en dos niveles y un solo diálogo

- **Estado:** vigente
- **Ámbito:** `src/shared/contexto.ts`, `src/shared/contexto-ipc.ts`, `src/main/contexto/`, `Profile.contextoGlobal`
  (`perfiles/types.ts`, `validar.ts`), `briefingCompuesto.ts`, `terminalAgente/apertura.ts` y `recarga.ts`,
  `reglas/componer.ts` y `operacionesReglas.ts` (`tctx reglas`, `tctx proponer --global`), `reglas/propuestasReglas.ts`
  (`ID_REGLAS_GLOBALES`), `configAgente/configCompartida.ts`, `configAgente/copiaConfigCompartida.ts` y, en el renderer,
  `features/agentes/contexto/` y `pestanas/CapaPropuestasReglas.tsx`

## Contexto

Lo que reciben los agentes tiene varias piezas: reglas, documentos de referencia y configuración técnica, y cada una
puede valer para todos los perfiles o para uno. Si cada pieza vive en su propio sitio, con su propio formato por
agente, es fácil escribir lo mismo dos veces, no saber qué recibe de verdad un agente y acumular reglas sin ver
cuánto ocupan.

## Decisión

- **Un solo concepto, el contexto, con dos niveles**: el global, para los agentes de todos los perfiles que lo usan,
  y el de cada perfil, que se suma después. Cada perfil decide si usa el global (`Profile.contextoGlobal`, ausente
  es que sí); apagarlo deja fuera las tres partes del global.
- **Cada nivel tiene tres partes, por lo que son y no por el archivo donde viven**:
  - **Reglas**: lo que el agente debe tener presente siempre. Un solo texto para Claude Code y Codex, que llega en
    el aviso de arranque, igual en nativo y en Docker ([reglas-del-perfil.md](reglas-del-perfil.md)). Las del perfil
    son `Profile.reglas`; las globales viven en el main, en `<userData>/contexto-global.json`. El aviso lleva las
    globales primero, cada nivel con su encabezado, y dice que una del perfil prevalece si contradice una global.
    El aviso entero (`briefingCompuesto.ts`) va en este orden: bases, SSH, reglas, `tctx docs`, `tctx buscar`,
    `tctx delegar` (o, en una tarea delegada, el de subagente) y el traspaso.
  - **Documentos**: carpetas de consulta que no entran en cada sesión; `tctx docs` lista las del global y las del
    perfil juntas, sin repetir ([documentos-del-perfil.md](documentos-del-perfil.md)).
  - **Configuración de Docker**: la técnica de cada agente (`settings.json`, `config.toml`), que el CLI superpone a
    la de la cuenta al abrir una sesión, sin que Tessera escriba en ella ([configuracion-editable.md](configuracion-editable.md)).
    Es la única parte por agente, porque es propia de cada CLI. Como las reglas, entra por la línea de arranque.
- **No hay instrucciones compartidas en archivos**: la capa global y la de cada perfil solo tienen configuración
  técnica. Lo común a varios agentes es una regla.
- **Un solo diálogo, «Contexto de los agentes»**: a la izquierda los niveles de la cascada, el global y cada perfil,
  y aparte, separado y dicho, «En su equipo», con el agente que se ejecuta fuera de Docker y no la recibe; a la
  derecha las secciones del nivel. Una cuenta de Docker no es un nivel del riel: es el ámbito más estrecho de la
  configuración de Docker de su perfil, y se elige en esa sección («Todas las cuentas» o una), donde están las capas
  que se suman. Así el riel no crece con las cuentas y no mezcla tipos de nivel. Lo abren
  Configuración › Agentes, «Reglas para los agentes…» del menú de un perfil y el menú «⋯» de una cuenta. Cambiar
  de nivel, de sección o de agente, o cerrar, con cambios sin guardar, pide confirmarlo.
- **El resumen de un perfil**, lo que reciben sus agentes: no es una sección, porque no se configura nada en él,
  sino un panel de solo lectura que se abre con «Resumen» desde la cabecera del perfil. Enseña las reglas y los
  documentos con el origen de cada parte, lo que suman las reglas, un aviso si pasan de un nivel lleno (6000
  caracteres), y aparte, explicado y sin poder editarlo, lo que añade Tessera por su cuenta (los avisos de bases,
  SSH, historial y documentos y, en Docker, el bloque del contenedor), para que el resumen esté completo.
- **Aviso antes del tope**: al pasar del 80 % de un nivel (`UMBRAL_AVISO_REGLAS`), el editor de reglas, el de una
  propuesta y su revisión dicen que las reglas ocupan contexto en cada sesión y que lo que solo se consulta a veces
  va en un documento; el editor lleva además a Documentos. Avisar al pasarse llega tarde para reorganizarlas.
- **Propuestas por nivel**: `tctx proponer` propone las reglas del perfil y `tctx proponer --global`, las globales;
  ninguna se aplica sin que el usuario la acepte. Como se propone la versión entera, `tctx reglas --perfil` y
  `--global` dan cada nivel tal cual, sin encabezados, para editarlo; un perfil que no usa el global no ve las
  vigentes y no puede proponerlas. La del global se guarda con un id reservado que no puede ser el de
  un perfil, y se revisa como las demás, diciendo desde qué perfil llegó. `tctx config proponer` queda para la
  configuración técnica.
- **En la copia de la configuración**, las reglas del perfil viajan con él, y el global (sus reglas y su
  configuración técnica) en el apartado del contexto; en apartados propios, los archivos que el usuario escribe en cada
  cuenta de Docker y las reglas de los agentes nativos ([exportar-importar.md](../configuracion/exportar-importar.md)).
  Las carpetas de documentos no viajan.

## Consecuencias

- Las reglas globales también llegan a los agentes nativos, no solo a los de Docker.
- El tope del aviso de arranque se mide con las dos reglas juntas; si no cabe, el aviso manda a leerlas con
  `tctx reglas`, que da las dos con su encabezado.
- Lo fijan `test:contexto` (la combinación, el almacén y el modelo del diálogo), `test:briefing-compuesto` (el
  aviso con los dos niveles), `test:propuestas-reglas` (las propuestas globales), `test:tctx` (`--global`),
  `test:config-compartida` (las capas sin instrucciones y la copia) y `e2e/contexto-agentes.spec.ts`.

## Descartes

- **Un archivo de instrucciones común por agente**: duplica las reglas en otro formato y solo llega a Docker.
- **Un nivel por proyecto**: lo propio de un proyecto ya tiene su sitio en el repositorio (`AGENTS.md`, `CLAUDE.md`),
  que el CLI lee solo.
- **Mezclar en una lista la configuración técnica con las reglas**: la técnica depende de cada CLI y de su versión;
  las reglas, no.
