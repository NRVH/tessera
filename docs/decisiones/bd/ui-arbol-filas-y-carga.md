# Cada fila del árbol de BD sabe su carga y su única acción, y las conexiones ajenas se explican con un solo criterio

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/filasArbolBd*.ts`

## Contexto

`DbArbol.tsx` necesita saber de cada fila qué la refresca, qué ofrece un error, qué se copia y
adónde va el cursor. Hay conexiones que esta versión no sabe abrir (motor desconocido, forma que
no reconoce, id repetido) y registros enteros que no se pueden leer.

## Decisión

- **Una fila de error tiene UNA acción, la que arregla el error:** «Instalar cliente…» si falta
  el nativo, «Vuelve a escribir la contraseña» si falta o no se descifra; solo lo demás se
  reintenta (reintentar ahí fallaría igual sin decir por qué).
- **El punto de sesión resume varias:** una viva basta para «conectada»; «caída» solo si alguna
  se perdió y ninguna sigue viva; «conectando» se pinta aparte porque abrir por VPN tarda.
- **Transacciones:** con todas en `fallida` no hay Confirmar (su COMMIT es un ROLLBACK que se
  daría por bueno); con mezcla, el botón dice que las fallidas se revierten.
- **Las flechas saltan «Cargando…» y «Vacío»**; los errores sí se visitan (Enter los resuelve).
- **Lo que depende del motor sale de su descriptor** (nombre, destino, nombre cualificado citado
  con las reglas del motor): sin comparar motores por su nombre.
- **Ajenas:** se VEN, atenuadas, al final y en el orden del main, sin mover los índices de las
  filas del árbol; no se despliegan ni se abren pero sí se recorren; su única acción es
  eliminar. NO son `FilaBd`, así que nada que abre o carga puede recibir una. Todo texto sobre
  ellas (fila, tooltip, diálogo, área vacía, popover de montaje) sale de las mismas funciones
  por su causa (`causaAjena`), y nunca aconseja «bórrala y créala otra vez».
- **Registro con formato ajeno:** aviso persistente en las tres superficies en vez de «Sin
  conexiones», altas apagadas con su porqué y la promesa de que no se pierde nada; los textos de
  la UI no afirman la causa (la dice el aviso del main).

## Consecuencias

Los textos de las ajenas y del formato ajeno viven en un solo sitio; las pruebas los fijan.

## Descartes

- Distinguir una edición a mano de una versión más nueva por el campo que falta: adivinar mal
  vuelve a dar el consejo equivocado.
