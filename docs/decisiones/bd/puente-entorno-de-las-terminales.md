# Entorno de las terminales nativas: `tdb` siempre en el PATH y un solo ámbito, lo montado

- **Estado:** vigente
- **Ámbito:** `src/main/db/hostEnv.ts`, `DbController.entornoHost`

## Contexto

El entorno del pty es el único canal por el que `tdb` llega al agente y a la terminal. Vivía como una clausura
en `index.ts` y nunca tuvo prueba: parte de por qué «monto una base y no aplica» sobrevivió tanto.

## Decisión

- El PATH con el atajo `tdb` se inyecta siempre, haya o no bases montadas. Sin él, no teclear `tdb` es
  indistinguible de «esta función no existe»; con él, `tdb` explica que no hay nada montado y cómo montarlo.
- Un solo ámbito: lo montado. El espacio de datos del perfil es un proyecto más y usa el mismo selector, aplicando
  en caliente; una regla menos es un sitio menos donde un proceso puede ver más de lo que se le dio. El agente
  arranca con 0 montadas. `TESSERA_DB_SCOPE` se define siempre, aunque sea vacío.
- Lo único que decide el nombre del sitio es una marca informativa (`TESSERA_DB_ESPACIO`, y la concesión del
  puente). En un proyecto se escribe vacía y no se omite, porque este entorno se fusiona encima del heredado y un
  `1` heredado haría hablar de «el agente de datos» a las terminales de un proyecto.
- Con puente no viaja ninguna contraseña; sin él, cada una lleva la huella de su destino (`variablesDeSecreto`, la
  misma función para terminales y para «Probar»).
- La comparación de rutas usa `path.win32` a propósito también en macOS: trata `/` y `\` como el mismo separador,
  que es la insensibilidad que necesita (`C:/…` y `C:\…` llegan de un estado persistido). Solo produce una clave
  de comparación. En POSIX, una carpeta llamada literalmente `a\b` compararía igual que `a/b`; la consecuencia es
  solo una etiqueta y la redacción de mensajes, no qué bases se ven.

## Descartes

- Sembrar los montajes del espacio con las verificadas (una bandera de migración); que `tdb` compare su `cwd`,
  que cambia con un `cd` y no sabe dónde está `userData`.
