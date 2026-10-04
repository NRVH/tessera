# La entrada de un pty de Windows lleva un oyente de error propio para que una escritura tardía no tumbe el proceso

- **Estado:** vigente
- **Ámbito:** `src/main/terminals/entradaPty.ts` y todo el que escribe en un pty

## Contexto

En Windows node-pty 1.1.0 escribe por `_agent.inSocket`, un `net.Socket` sin oyente de `'error'`.
Si el proceso del pty ya salió (o está saliendo) cuando llega un `write`, el socket emite `EAGAIN`
sin nadie escuchando: excepción no capturada, asíncrona, que los `try/catch` alrededor de
`pty.write` no ven. Escribir en un pty que muere ocurre en el cierre elegante (`^C` y `exit`), en
`detenerSesion` y al teclear en un pane cuyo proceso acaba de salir. Con el lector cerrado el error
es reproducible 8 de 8 veces; descartarlo no pierde nada que alguien fuera a leer.

## Decisión

`blindarEntradaPty` pone ese oyente en el socket, una vez por pty y antes de que nadie escriba. En
macOS y Linux no hay socket de entrada y no hace nada: la rama es por forma, no por plataforma.
Como `_agent.inSocket` no es API pública, en Windows su ausencia se avisa una vez por proceso, y
`test-onexit-reload.mts` comprueba contra un pty real que el oyente está puesto.

## Consecuencias

- Al subir node-pty hay que ejecutar `test:onexit`: si renombran el socket, el blindaje se apaga
  sin más síntoma que el aviso y las líneas `EXCEPCIÓN NO CAPTURADA` en `crash.log`.

## Descartes

- Mirar `exitCode` antes de escribir: node-pty lo fija unos 50 ms después de que el proceso murió y
  una escritura en esa ventana ya falla; además serían tres sitios que vigilar, uno en el renderer.
- Parchear node-pty: otra pieza que mantener y que se pierde al reinstalar.
- Filtrar en el `uncaughtException` global: es lo que escondía el fallo y ahí no se distingue de uno
  de verdad.
