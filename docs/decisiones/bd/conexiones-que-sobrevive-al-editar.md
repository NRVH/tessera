# Qué sobrevive a editar una conexión

- **Estado:** vigente
- **Ámbito:** `src/main/db/conservarAlEditar.ts`, `ConnectionStore.update`

## Contexto

`update` reconstruye el registro desde el formulario, que no conoce lo que el main fue aprendiendo. Conservar
de más deja montar una conexión que nunca respondió; conservar de menos obliga a volver a elegir 30 esquemas
por cambiar el alias.

## Decisión

Cada dato tiene su regla:

- **Contraseña:** `undefined` conserva la guardada, `''` la borra, un texto la sustituye (ya cifrada).
- **`driverId`:** se conserva si no cambian host ni puerto.
- **`verificadaEn`:** solo si no cambió nada de lo probado (destino, instancia, SRV, opciones, autenticación,
  dominio, cifrado, usuario, contraseña). El entorno no cuenta: no cambia el destino.
- **`orden`:** siempre. **`esquemas` y `bases`:** si no cambió el motor. **`introspeccion`:** si no cambió el
  servidor ni el usuario. Un valor explícito de la entrada gana.
- **Entorno:** manda el formulario; uno que esta versión no entiende sobrevive hasta que se elija uno conocido.
- **Claves que esta versión no gobierna** (`CLAVES_GOBERNADAS`, completa por tipo): sobreviven, salvo que cambie
  la dirección (motor, host, puerto, archivo, instancia o SRV). Entonces el usuario lleva la conexión a otro
  servidor y no se conserva nada: un túnel o una CA de una versión más nueva quedarían pegados al servidor nuevo.

## Consecuencias

- Cambiar de servicio o de usuario en la misma máquina es una edición rutinaria y conserva lo no gobernado.
  Una clave nueva ligada al usuario o a la base quedaría sin cubrir; la versión que la escriba puede gobernarla.
- «Probar» toma la huella de lo probado (`huellaDestinoProbado`) al lanzar y la vuelve a mirar al terminar: si
  se guardó otro destino o contraseña (o se borró) con la prueba en vuelo, no apunta ni verificación ni driver.
- No muta `previo` ni `nuevo`. Lo que no se conserva se borra como clave, no queda a `undefined`, para que el
  JSON persistido no cambie.
