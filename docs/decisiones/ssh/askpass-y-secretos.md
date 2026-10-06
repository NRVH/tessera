# SSH: las conexiones recuerdan la contraseña o la frase, y la da un programa de contraseñas que pregunta a Tessera

- **Estado:** vigente
- **Ámbito:** `src/main/ssh/` (`preguntasAskpass.ts`, `fichasAskpass.ts`, `programaAskpass.ts`, `controlador/askpassSsh.ts`,
  `controlador/pruebaSsh.ts`, `ConexionesSsh.ts`), `src/askpass/`, `scripts/compilarAskpass.mjs` y el diálogo de `features/ssh/` (macOS: sin verificar)

## Contexto

Medido en Windows con el ssh 9.5 del sistema (y el 9.9 de Git): un askpass `.exe` con `SSH_ASKPASS_REQUIRE=force` contesta contraseña,
keyboard-interactive y frase, en ConPTY y sin consola (~150 ms). Con `NumberOfPasswordPrompts=1`, una contraseña mala es UNA pregunta y
255. ssh recorta en la pregunta el usuario a 30 bytes y la ruta de la clave a 100 (medido: una copia de 169 bytes llega con 100). Y lee
`SSH_ASKPASS` en la página de códigos ANSI: una ruta con «ñ» o tildes no la lanza; buscada por el `PATH`, sí.

## Decisión

- Secreto de solo escritura (ausente conserva, '' borra, un texto sustituye; ≤1000 bytes, sin saltos), cifrado con `safeStorage`; sin
  almacén no se guarda. Al renderer, solo `tieneSecreto` y `secretoIlegible`. Otro método, otro destino u otra clave lo descartan.
- Programa: en Windows, `out/askpass/tessera-askpass.exe` (C# 5, csc de .NET 4, `/target:winexe`), lanzado por su NOMBRE con su carpeta
  delante en el `PATH`; en macOS, un lanzador `sh` en `userData/ssh/askpass/askpass` que arranca Tessera como Node con
  `src/askpass/askpass.cjs`. Pregunta al puente de `tdb` (`ssh.askpass`); si Tessera no contesta, sale con 1 y una línea fija.
- Contesta SOLO la contraseña de ESA conexión («u@h's password: », «(u@h) Password: ») y la frase de SU copia (como prefijo si llega
  recortada). Un PIN, un código, una huella o algo truncado se cancela, y esa conexión se teclea hasta que se edite.
- Fichas propias, atadas a una conexión, en tiempo constante: pestaña 2 min y 2 usos (contraseña y keyboard-interactive), revocada al
  cerrar o reconectar; «Probar» 60 s. El token de sesión de un agente nunca vale para `ssh.askpass`.
- Sin puente, sin programa o con el secreto ilegible, la pestaña se abre sin él (se teclea) con un aviso: NUNCA el secreto en el entorno.
  El registro apunta la conexión y la decisión, nunca la pregunta ni el secreto.
- «Probar»: la línea de la pestaña sin terminal, con `exit 0` y 20 s de tope; `accept-new` guarda la huella (el agente, en estricto, solo
  usa hosts que confirmó una persona). Sin el secreto que el método pide, solo saluda (`none`). «Olvidar la huella» vacía su `known_hosts`.
  Solo el 255 es un fallo de ssh: cualquier otro código lo dio el otro lado, así que entró (ForceCommand, git-shell, equipos de red que no
  aceptan `exit 0`).

## Riesgos aceptados

- **Una instalación de Windows cuya carpeta lleva «;» y además caracteres no ASCII** (decisión del usuario, 5-oct-2026). El programa va
  por su nombre con su carpeta en el `PATH` porque el ssh del sistema no lanza una ruta con «ñ» o tildes (medido); un «;» partiría el
  `PATH`, así que en ese caso se cae a la ruta entera, que con caracteres no ASCII volvería a fallar: la contraseña guardada no se da y
  se teclea, con el aviso de siempre. Sin medir con una instalación así; las dos cosas juntas en la carpeta de instalación son raras.

## Modelo de amenaza

El agente nativo corre como el usuario: puede leer su `userData`, hablar con el puente y pedir lo mismo que pide Tessera. Las fichas y la
copia protegida de la clave son higiene —el secreto no está en el contexto, ni en el entorno, ni en los registros—, no una frontera.

## Descartes

- Un `.cmd` como askpass: cmd.exe vuelve a analizar la pregunta (en keyboard-interactive la escribe el servidor: inyección) y la corta.
- `NODE_OPTIONS` para colar un askpass en Node: depende de los fusibles de Electron y lo heredaría todo lo que se lance.
- El secreto en el entorno del ssh: lo heredan sus hijos y se ve en un volcado del proceso.
- Un diálogo de Tessera para cualquier pregunta del servidor: el texto es del servidor, y se confirmaría a ciegas un código o una huella.
