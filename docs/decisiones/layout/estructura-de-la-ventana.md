# La ventana es un marco fijo con la franja inferior dentro de la columna principal

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/App.tsx`, `features/layout/`, `styles.css` (`.shell*`, `.panel-lateral`)

## Contexto

La ventana se crea sin barra de título nativa y el renderer pinta la suya; el sistema dibuja los
botones de la ventana encima del contenido. Las superficies con sesión viva (terminales, agentes,
editores) no pueden desmontarse al cambiar de vista o de proyecto sin perder su estado.

## Decisión

```
[ barra de título + perfiles + proyectos (ancho completo) ]
[ riel | columna principal: [ lateral | centro | agente ] / franja inferior ]
[ barra de estado ]
```

- A pantalla completa de la franja inferior, la banda de proyectos se aparta y la franja sube a ocupar
  su alto (`pantalla-completa-de-la-franja.md`).
- La franja inferior (terminal o Git·Log) vive DENTRO de la columna principal y ocupa todo su
  ancho, también bajo el lateral; no es hermana del cuerpo: de ancho completo recortaría el riel.
  El riel es su propia tarjeta, así que no tiene que medir lo mismo que el lateral. Unir riel y
  lateral en una tarjeta obligaría a sacar la franja de debajo del lateral, y la franja estrecha
  se echa de menos más de lo que gana la unión.
- La terminal y la columna del agente nunca se desmontan: se ocultan por CSS. Git·Log se monta
  bajo demanda (sus cachés hacen instantáneo reabrirlo).
- El editor y el área de BD se ocultan enteros (sin desmontar) cuando el centro es de otra cosa.
- El lateral es una tarjeta (`.panel-lateral`) con el ancho de la vista que se ve; dentro va el
  lateral de esa vista y, ocultos con su mismo tamaño, los de BD y archivos ya vistos
  (`renderer/vivos-y-ocultos.md`). Al cambiar de vista la tarjeta no cambia de nodo.
- La app arranca sin proyecto activo; todo pinta el proyecto que se ve (`objetivoVisto`) y solo lo
  que pide contra la raíz anclada espera al confirmado
  (`renderer/objetivo-de-git-derivado.md`).
- El mosaico solo cambia la clase del contenedor: el árbol es el mismo dentro y fuera.
- La marca de la barra de estado va centrada mientras cabe; si lo de la derecha no cabe, cede su sitio con un fundido y
  la derecha toma el ancho que no ocupa la izquierda. Es el primer peldaño de la escalera de la barra
  (`useEscalonBarra.ts`, `data-escalon`); los siguientes los usa el uso de las cuentas
  (`agentes/uso-ventanas-de-la-cuenta.md`), que sale de la barra en el mosaico.

## Consecuencias

Al partir un componente de layout no se añaden envoltorios al DOM (fragmentos): el CSS
selecciona por esta estructura. Cambiar un «ocultar» por un desmontaje mata sesiones.
