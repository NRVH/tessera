# El borrador de una conexión: la contraseña es de solo escritura y solo viaja lo que el motor declara

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/borradorConexion.ts`

## Contexto

El borrador es lo que edita el diálogo y lo que se convierte en `DbConnectionInput`. En el main, `password: ''`
significa «bórrala», y la huella del destino se calcula sobre el registro: un campo de más la cambia.

## Decisión

- Contraseña de SOLO ESCRITURA: una edición la lleva `undefined` y un campo vacío CONSERVA la guardada, aunque
  se haya tocado. Tras guardar, el borrador vuelve a «(sin cambios)» para no re-mandarla.
- Cambiar de motor resetea el puerto al del motor. Lo que el motor no enseña se conserva en el borrador y no
  viaja (`limpiarParaGuardar`). El alta parte de Oracle, escrito a mano y no del orden del registro.
- «¿Hay cambios?» compara campo a campo los dos borradores ya limpios; un alta y una contraseña escrita siempre
  cuentan; un archivo elegido de nuevo también, aunque se llame igual.
- Entorno `null` no viaja: ausente es «sin entorno» también al editar.
- Motor de archivo: viaja la FICHA del archivo nuevo, nunca una ruta; sin credenciales no se manda contraseña.
  Una base creada conserva la casilla de los agentes como venga.
- Los opcionales (instancia, autenticación, dominio, cifrado, SRV, opciones) están SIEMPRE en el borrador, y
  solo viajan y cuentan como cambio con un motor que los declara (`usaOpcional`); el dominio, solo con una
  autenticación que lo pide. Oracle y PostgreSQL mandan la entrada de siempre, al byte.
- El cifrado SIGUE al implícito (del motor, o cifrar con SRV) mientras sea el implícito de lo anterior; si el
  usuario lo cambió, se queda. Con SRV, un puerto inválido vuelve al del motor.
- «Pegar URI» (`conUri`) rellena lo común de la URI y la contraseña solo si la trae; en una edición, sin ella
  se conserva la guardada. Lo propio de otro motor que esa URI no trae no se toca.
- La base de autenticación tiene campo propio pero vive en `opcionesUri`: se separa al abrir y se une al
  guardar en el mismo sitio y con el mismo texto si no se tocó.

## Consecuencias

- Borrar la contraseña guardada no tiene gesto. Qué conserva el main al editar: `conexiones-que-sobrevive-al-editar.md`.

## Descartes

- Una bandera «cifrado tocado» en el borrador: no sobrevive a abrir una conexión guardada.
- `entorno: undefined` explícito: un main futuro podría leer distinto un campo presente y vacío.
- Guardar `authSource` como campo del registro: cambiaba el main, `tdb` y la huella del destino.
