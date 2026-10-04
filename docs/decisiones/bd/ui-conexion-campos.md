# Los campos de una conexión por motor: reglas del descriptor compartido, presentación en el renderer

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/camposConexion*.ts`

## Contexto

El formulario marca en rojo lo que el main rechazaría y pinta los campos de cada motor. Si las reglas se
escribieran dos veces, formulario y main discreparían; si la presentación fuese `if` por motor, cada motor
nuevo olvidaría algún sitio (el del guardado no se ve).

## Decisión

- Las REGLAS son del descriptor de `shared/motores/` (`conexion.*`: obligatorios, excluyentes, opcionales, qué
  se descarta, usa clientes). El renderer añade solo la PRESENTACIÓN (`PRESENTACION`: filas, etiquetas,
  placeholders, `ancho` como palabra y no como clase, la ayuda de cada grupo excluyente por POSICIÓN).
- El main es la autoridad: `faltantes` y `enConflicto` aplican sus reglas sobre lo que VA A GUARDAR
  (`limpiarDestinoBd`) solo para marcar. «Falta» incluye las cotas del puerto y del nombre. El nombre
  duplicado no se replica. La paridad la fija `test-campos-conexion.mts`.
- La validación en vivo es un dato del CAMPO (`validar`), con la MISMA función que aplica el main
  (opciones de la URI de MongoDB, base numérica de Redis).
- Se esconde o apaga por el VALOR del borrador, no por el motor: el dominio solo con una autenticación que lo
  pide; el puerto APAGADO (no escondido) con SRV, y a la vista con una instancia de SQL Server (su ayuda dice
  que no se usa): un campo que desaparece al tocar otro desorienta y el main sigue exigiendo host y puerto.
- Lo que el motor no enseña (el SID fuera de Oracle) se DESCARTA al guardar (`limpiarParaGuardar`), no del borrador.
- Entorno y «Solo lectura para los agentes» no son del destino. La ayuda de solo lectura mira primero el
  candado del motor (si lo impone Tessera, no promete lo del servidor) y luego las credenciales.
- La oferta de «Confiar en el certificado» reconoce la cita de su etiqueta en el mensaje del main.

## Consecuencias

- Cambiar una regla en el descriptor la ven a la vez el formulario y el main.
- El archivo de un motor de archivo no es una fila de texto: es el selector del diálogo (`deArchivo`).
- La forma en disco de los opcionales: `conexiones-campos-opcionales.md`.

## Descartes

- Mover la ayuda de los excluyentes al descriptor compartido: es texto del formulario y el main no la enseña.
- Un `case 'database'` para validar la base de Redis: habría tenido que preguntar por el motor.
