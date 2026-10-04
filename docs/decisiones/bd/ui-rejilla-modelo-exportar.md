# Exportar a archivo lo escribe el main, y el renderer solo sigue su progreso y lo cuenta

- **Estado:** vigente
- **Ámbito:** `src/renderer/src/features/bd/rejilla/{exportarBd,useExportarBd}.ts`

## Contexto

Exportar escribe la tabla o la consulta entera, por páginas, a un archivo que elige el usuario.
El renderer no ve rutas del host, y hay un exportador montado por cada pestaña de datos y de
resultado de todos los perfiles.

## Decisión

- El renderer pide `EXPORTAR`; el main abre el diálogo nativo, escribe con el serializador de
  «Copiar como» y devuelve solo el NOMBRE y un `token` opaco para «Mostrar en …».
- El progreso llega a toda la ventana sin destinatario: UN oyente para todas (el repartidor),
  puesto solo mientras alguna exportación escucha, y cada aviso va a la suya por `peticionId`.
  Con un oyente por exportador montado, a partir del undécimo el `ipcRenderer` avisaba de una
  fuga que no existía.
- Una exportación por dueño; una segunda en el mismo tic se ignora (su Detener pararía otra).
- La píldora aparece con el primer progreso, no con el diálogo abierto (parecería que ya
  empezó). «Exportando…» sin cifra hasta entonces: un «0 filas» parecería atascada.
- El final: bien, aviso con «Mostrar en <gestor>» (de `nombresSistema`, con la plataforma por
  parámetro); diálogo cancelado, nada; `cancelada`, aviso discreto; otro fallo, error.
- El tamaño va en el aviso con la base del gestor de archivos de cada sistema (1000 en Mac,
  1024 en el resto) y coma decimal: los dos dicen lo mismo del mismo archivo.
- Al desmontar la pestaña que la lanzó, se cancela: seguiría trabajando sobre una sesión sin
  nadie que enseñe su progreso ni ofrezca Detener.

## Descartes

- `ipcRenderer.setMaxListeners(0)`: es de todo el emisor y taparía fugas reales en otros canales.
- Un multiplexor en el preload: sigue llamando a todos y cambia `onExportacion` para quien ya lo usa.
- Suscribirse solo al exportar, sin repartidor: N exportaciones en marcha volverían a ser N oyentes.
