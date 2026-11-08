# Cambiar de perfil tiene un presupuesto de repintados que no depende de los proyectos abiertos

- **Estado:** vigente
- **Ámbito:** `e2e/rendimiento-perfiles.spec.ts`, `util/contadorRenders.ts`, `util/diagnosticoRendimiento.ts`

## Contexto

Con muchos proyectos abiertos, cambiar de perfil se nota lento si cada render de la ventana repinta
los panes vivos de todos los perfiles, y sin una medida nada impide que una prop nueva lo provoque.

## Decisión

- Un diagnóstico APAGADO por defecto, `window.__tesseraRendimiento`, cuenta renders por componente
  e instancia, redimensionados del pty, tramos (`perfil:cambio`, `webgl:crear`) y tareas largas. Se
  enciende en la app instalada desde las herramientas de desarrollo (F12): `activar()`, usar,
  `informe()`. Apagado, cada punto de medida es una comparación; no usa `process` ni IPC.
- El e2e mide el PEOR caso por cambio, en caliente, con 4 y con 12 proyectos, con un proyecto
  visitado por perfil y con todos visitados. Presupuesta RECUENTOS, que son deterministas; los
  tiempos solo se informan, porque dependen de la máquina y de lo que haya en marcha.
- El contrato: 2 panes repintados por cambio (el que sale y el que entra) y sin redimensionar el
  pty (se tolera un cambio de cada doce: un pane recién abierto que aún asienta su alto), con
  cualquier número de proyectos. La primera visita a un perfil admite 3 panes.

Medido con agentes falsos (peor caso por cambio; entre paréntesis, la primera visita):

| Proyectos | Panes repintados | Renders de pane | Renders de App |
|---|---|---|---|
| 4 | 2 (3) | 3 (12) | 8–9 |
| 12 | 2 (3) | 3 (12) | 8–10 |

## Consecuencias

- Un presupuesto que salta señala una prop de pane que perdió la identidad estable (ver
  `agentes/pane-del-agente-sin-re-render.md`), no una máquina lenta.
- Con `TESSERA_E2E_SOLO_MEDIR=1` el spec imprime la tabla y no exige nada: sirve para sacar la
  línea base de un binario antes de optimizarlo.

## Descartes

- Presupuestar milisegundos: en un equipo cargado da rojos falsos y en uno rápido no ve nada.
