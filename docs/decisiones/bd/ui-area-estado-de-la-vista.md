# El estado de la vista de BD vive en memoria por perfil y solo se poda con listas que se entienden

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/dbVistaEstado.ts`, `useDbVista.ts`, `dbMounts.ts`

## Contexto

Las pestañas, los nodos expandidos y la selección del árbol son por perfil (cambiar de perfil no
cierra lo del otro), y los montajes de bases por proyecto se guardan en los ajustes. Todo eso
crece si no se poda al borrar perfiles, conexiones o consolas, y una poda con una lista
equivocada cierra o desmonta lo que no debe, sin vuelta atrás.

## Decisión

- NADA de la vista se persiste: restaurar pestañas al arrancar lanzaría consultas contra bases
  que quizá no están a tiro (VPN) y reabriría filtros que ya no aplican. Las consolas sobreviven
  como archivos; lo persistido de la vista (anchos, altos) vive en los ajustes.
- Vive en el store de BD y lo lee `useBdApp`, no el árbol ni el área: el lateral se DESMONTA al
  cambiar de vista y lo desplegado o abierto tiene que seguir ahí al volver. Sus acciones son
  ESTABLES: las usan listeners registrados una vez (Mod+N) y deps de efectos de los panes.
- Podar es la única forma de que no crezca, y una poda que no toca nada devuelve el MISMO mapa.
- `podarPerfiles` es exacta (con una lista vacía lo borra todo): la guarda de «la lista aún no ha
  llegado» es del hook; una función pura que a veces no poda no se puede probar.
- `podarConexiones` solo toca los perfiles del mapa: de uno cuya lista no se conoce no se sabe qué
  sobra. Borrar una conexión poda solo en SU perfil (pestañas y montajes): una copia pegada en
  otro perfil comparte el id y no puede perder lo de su original.
- `revelar` lleva un TOKEN que crece: pedirlo dos veces para la misma fila vuelve a desplazar.
- Con un registro de FORMATO AJENO (o ilegible y sin `.bak`, que llega con la misma marca) el main
  devuelve las listas vacías con `formatoAjeno`, y las dos podas por conexión se SALTAN
  (`vivosParaPodar`, `vivasParaPodarPestanas`): sin una lista que se entienda no se poda nada,
  igual que con el `.catch` de la poda de arranque.
- La clave de montaje se parte por el PRIMER `|`: la ruta de Windows puede llevar casi cualquier
  cosa y el id de perfil no lleva `|`.

## Consecuencias

- Contar las listas vacías de un formato ajeno como «las que existen» desmonta las bases de todos
  los proyectos al arrancar y lo guarda; al volver a leerse el registro, las conexiones vuelven y
  los montajes no.
