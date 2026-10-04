# Las rutas del host se clasifican por la forma de su raíz y se comparan sin distinguir mayúsculas, nunca por `process.platform`

- **Estado:** vigente
- **Ámbito:** `src/shared/rutasHost.ts`; lo usan la cola de aperturas y `main/shell/resolverApertura.ts`, que confirma la caja contra el disco

## Contexto

Este módulo decide si una ruta cae dentro de un proyecto ya abierto; si se equivoca, «Abrir con Tessera»
acuña un SEGUNDO proyecto solapado sobre el que ya estaba. Corre bajo `node` en los tests y recibe rutas
de las dos familias: los proyectos abiertos vienen de `workspace-state.json`, que puede haberse copiado
desde la otra plataforma.

## Decisión

- La familia la da la raíz: `X:`, `X:/`, `X:\`, `\\servidor\recurso` y `//servidor/recurso` son Windows;
  `/…` con una barra es POSIX. Una ruta de la otra familia queda inerte: no desciende de nada.
- `//x` es UNC: Windows lo acepta como tal y nada del repo produce un `//x` POSIX (`path.resolve` y
  `path.normalize` colapsan las barras iniciales). Un test lo fija: sin eso, un proyecto en un recurso
  de red escrito con barras normales no se reconocía como abierto.
- La comparación es case-insensitive también en POSIX (APFS no distingue por defecto). La insensibilidad
  vive en la COMPARACIÓN, nunca en el dato devuelto.
- `esDescendienteHost` compara siempre contra el ancestro con separador final: `D:\proyecto2` empieza
  por `D:\proyecto`.
- Única excepción a «nada de `process.platform`»: `normalizarRelativaProyecto`. El relativo que manda el
  renderer no lleva raíz y su forma no distingue separador de carácter. Vive aquí por ser la inversa
  exacta de `relativaPosixHost`: si no aplican la misma regla, la ida y la vuelta no cierran.
- No toca el disco: existencia y tipo los mira `main/shell/resolverApertura.ts`.

## Consecuencias

En un volumen case-sensitive la aritmética reconoce de más: activar `Proyecto` al pedir `proyecto/a.ts`
abriría OTRO archivo. `resolverApertura` lo confirma con dispositivo + inodo solo si la caja difiere (sin
inodo, como en algunos recursos de red, se queda la comparación sin caja).

## Descartes

- `path.win32` a secas: `path.relative` respeta mayúsculas (`D:\Proyectos` y `d:\proyectos`, distintas).
- Decidir por `process.platform`: una ruta de la otra familia se destrozaba (una `\` metida en una ruta
  de macOS) en vez de simplemente no casar.
- «Si contiene una barra invertida, es Windows»: en POSIX es un carácter legal de nombre de archivo.
