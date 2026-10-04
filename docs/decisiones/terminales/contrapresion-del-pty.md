# La salida del pty se frena con marcas alta y baja, y una pausa nunca dura más de cinco segundos

- **Estado:** vigente
- **Ámbito:** `features/terminales/flowControl.ts` y las terminales que lo usan

## Contexto

El main agrupa la salida del pty por fotograma, pero un proceso que escupe megabytes puede
producir más rápido de lo que xterm parsea. Sin freno la cola interna de xterm crece sin límite y
el hilo de la interfaz se atasca. La reanudación depende de que xterm llame al callback de su
`write`, y ese callback puede no llegar nunca: al resetear o destruir la terminal con datos
pendientes la cola se descarta con sus callbacks.

## Decisión

- Se cuentan los bytes escritos y aún no procesados. Al cruzar la marca alta (1 MB) se pide al
  main pausar el pty; al bajar de la marca baja (200 kB) se reanuda (histéresis).
- Un vigilante de 5 s reanuda por su cuenta si el callback se perdió.
- El contador tiene suelo en 0: los callbacks en vuelo tras un `reset()` o tras el vigilante
  siguen llegando y, sin suelo, llevaban `pending` a negativo.

## Consecuencias

- Quien reinicia una terminal debe llamar a `reset()` del escritor junto con `term.reset()`.
- Sin el suelo, la marca alta no se alcanzaba nunca más y la contrapresión se apagaba en silencio.
- Con el pty pausado el main congela el inspector de progreso: sin vigilante el punto del perfil
  se quedaba respirando aunque el agente hubiera terminado.
