# Una sesión perdida nunca se re-ejecuta, y con una confirmación en camino «no se sabe»

- **Estado:** vigente
- **Ámbito:** `src/main/db/explorador/sesiones/` (`NucleoSesiones`, `procesos`, `consola`, `resultadoSentencia`, `transacciones`, `errores`) y `maquinaSesion.ts`

## Contexto

Una sesión se pierde por la red, por el proceso o por un plazo vencido. Si el COMMIT ya viajaba,
el servidor pudo aplicarlo antes de que se cortara la respuesta. Decir «revirtió» invita a
repetir los cambios, y un INSERT repetido duplica filas.

## Decisión

- Nada del usuario se re-ejecuta solo: la sesión queda `perdida` y se reabre en la siguiente
  operación. Solo el CATÁLOGO (SQL de Tessera, de lectura) se reintenta UNA vez.
- Un vigilante vencido (`TESSERA-PLAZO`) da el proceso por colgado: se mata y sus sesiones
  pasan a perdidas como caída.
- Con una confirmación en camino (`commitEnCamino`) el error y el aviso dicen que NO se sabe si
  se aplicó, nunca «revirtió». Llevan una: el COMMIT del botón y uno escrito, una escritura en
  Auto, un DDL de Oracle, un bloque PL/SQL de Oracle con un COMMIT escrito
  (`plsqlConCommitEscrito`, la misma regla del renderer) y, en Manual, CUALQUIER bloque o rutina
  de Oracle (`porDentro`): pueden confirmar por dentro sin que se vea.
- `perder` y `alSalirProceso` se lo dicen a la máquina, que llega antes que el rechazo de la
  operación en vuelo.

## Consecuencias

- Los textos (`MENSAJES.*EnCommit`, `*PorDentro`, `mensajeFalloCommit`) los ve el usuario y los
  comparan las pruebas.
- En solo lectura nada se confirma: cada sentencia va en su transacción y se revierte.

## Descartes

- Re-ejecutar tras una pérdida: un UPDATE se aplicaría dos veces si el COMMIT ya había llegado.
- Aceptar «revirtió» para las rutinas de Oracle en Manual. MEDIDO (11.2 y 21c): un INSERT
  pendiente, un `CALL` de un procedimiento con COMMIT y Forzar a mitad dejaban la fila
  CONFIRMADA mientras Tessera decía que se había revertido. Un DML, una consulta o un ALTER
  SESSION no pueden confirmar la transacción, así que siguen diciendo «revirtió»; en PG un
  COMMIT dentro de un CALL o un DO falla.
