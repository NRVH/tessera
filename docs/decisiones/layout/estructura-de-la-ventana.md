# La ventana es un marco fijo con la franja inferior dentro de la columna principal

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/App.tsx`, `features/layout/`, `styles.css` (`.shell*`)

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

- La franja inferior (terminal o Git·Log) vive DENTRO de la columna principal, no como hermana
  del cuerpo: de ancho completo recortaba por abajo el riel de iconos.
- La terminal y la columna del agente nunca se desmontan: se ocultan por CSS. Git·Log se monta
  bajo demanda (sus cachés hacen instantáneo reabrirlo).
- El editor y el área de BD se ocultan enteros (sin desmontar) cuando el centro es de otra cosa.
- La app arranca sin proyecto activo; explorador, git y terminal siguen al proyecto CONFIRMADO
  por el backend, no al que la interfaz ya pinta.
- El mosaico solo cambia la clase del contenedor: el árbol es el mismo dentro y fuera.

## Consecuencias

Al partir un componente de layout no se añaden envoltorios al DOM (fragmentos): el CSS
selecciona por esta estructura. Cambiar un «ocultar» por un desmontaje mata sesiones.
