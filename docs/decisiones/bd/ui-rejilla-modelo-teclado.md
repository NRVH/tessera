# El teclado de la rejilla sigue a las hojas de cálculo y fija sus mitades negativas

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/rejilla/tecladoRejilla.ts`, `DbRejilla.tsx`, `EditorCelda.tsx`

## Contexto

La misma rejilla sirve a la pestaña de tabla (editable) y a los resultados de la consola, que
vive encima con sus propios atajos. En Mac cambia el modificador y a veces la tecla misma.

## Decisión

- Navegar: flechas (Mayús extiende), Mod+flechas al borde (en Mac ⌃+flecha es del sistema y el
  gesto nativo es ⌘+flecha), Inicio/Fin y Mod+Inicio/Fin, RePág/AvPág, Mod+A, Mod+C (TSV) y Esc.
- El visor es Mayús+Intro en las dos. No lo abren Intro, Mod+Intro (ejecuta en la consola de
  encima), Mod+Mayús+Intro, el modificador ajeno ni Alt/⌥.
- Mitades negativas: el modificador ajeno (⌃ en Mac, ⊞ en Windows), los dos a la vez y Alt/⌥
  no hacen nada; Mod+RePág/AvPág tampoco (en Chromium cambian de pestaña).
- Tab saca el foco de la rejilla (un solo punto de tabulación, `role=grid`), no mueve de celda.
- Editar (solo tabla editable; se pregunta antes que a la navegación): F2 e Intro editan; una
  tecla imprimible empieza a editar sustituyendo; ⌫ edita con la celda vacía; Supr, y ⌘⌫ en Mac,
  borran filas; Ctrl+Alt+N / ⌥⌘N ponen NULL; Ctrl+Alt+Z / ⌥⌘Z revierten; Mod+Intro envía.
- En el editor de celda: Intro y Mayús+Intro confirman y bajan o suben; Tab y Mayús+Tab avanzan
  o retroceden; Esc cancela; Alt+Intro es un salto de línea; Mod+Intro confirma y envía.
- F2 con modificador no edita (Ctrl+F2 es Detener). Escribir: un carácter sin Mod; en Windows
  Ctrl+Alt solo si es AltGr de verdad (Ctrl+Alt+B alterna el agente); en Mac ⌥ compone y vale.
- Borrar filas es Supr y no ⌫: ⌫ vacía la celda para escribir, como en las hojas de cálculo.
  Ctrl+Supr y Ctrl+⌫ no borran filas.
- NULL y Revertir van por la tecla FÍSICA (`code`): en Mac ⌥ compone la `key`, y en Windows
  AltGr anula (AltGr+N o AltGr+Z escriben letras en algunas distribuciones).
- Enviar solo con el modificador principal y sin Mayús (Mod+Mayús+Intro ejecuta todo).

## Consecuencias

La plataforma es un parámetro: `test-rejilla.mts` fija las dos, con sus mitades negativas.

## Descartes

- Acorde para «Copiar como»: Mod+Mayús+C es el inspector y la copia de las terminales.
- Acorde para añadir fila: ⌘N es «nueva consola» y Mac no tiene Insert. Va por la barra.
