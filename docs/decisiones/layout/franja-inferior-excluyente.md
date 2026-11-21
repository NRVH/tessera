# La franja inferior es una sola: terminal o Git·Log, nunca los dos, con el alto compartido y recordada por perfil

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/layout/` (`store.ts`, `useVistasPorPerfil.ts`, `useTamanos.ts`, `franjaDesacoplada.ts`), `panelInferiorPorPerfil` en `src/shared/workspace-state-ipc.ts`

## Contexto

Bajo la columna principal viven la terminal y el historial de git (Git·Log), los dos a todo el
ancho. El historial necesita más alto mínimo que una terminal, y abrirlo antes de tiempo pregunta a
git por el repo equivocado.

## Decisión

- En la ventana principal, un solo hueco, un solo alto (`--panel-inferior-h`, persistido bajo la clave histórica
  `terminalHeight`) y un solo divisor. Abrir un panel sustituye al otro; pulsar el que ya se ve
  cierra la franja. Con ella acoplada, `Ctrl` `` ` `` lleva a la terminal desde Git·Log y cierra
  la terminal si ya se ve.
- Qué panel mira cada perfil (`'terminal'`, `'gitlog'` o `''`) vive en `panelPorPerfil` y se
  persiste por perfil (`panelInferiorPorPerfil`).
- Un Git·Log restaurado se mantiene cerrado (`franjaLibre`) hasta que hay un proyecto que mirar o el
  usuario toca la franja: antes no tendría de quién pedir nada. La terminal se restaura en el acto.
- El suelo del divisor depende del panel visible (`ALTO_TERMINAL_MIN` frente a `PANEL_GIT_MIN`: con
  el de la terminal las tres columnas del historial no dejan ni una fila), y al cambiar de panel el
  alto se recorta al alza.
- La terminal nunca se desmonta (solo se oculta): su sesión sobrevive con Git·Log delante. Git·Log sí
  se monta bajo demanda; sus cachés de módulo hacen que reabrirlo sea instantáneo. El anfitrión
  conserva el panel vivo al [desacoplarlo y acoplarlo](franja-desacoplada.md).

## Consecuencias

La pantalla completa efectiva solo se aplica al panel acoplado que está a la vista en la principal
([`pantalla-completa-de-la-franja.md`](pantalla-completa-de-la-franja.md)).
