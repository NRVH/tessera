# El Instant Client de Apple Silicon se instala desde un .dmg: huella, montaje propio y `cp -P`

- **Estado:** vigente
- **Ámbito:** `src/main/db/instalarDmg.ts`, `DriverManager.doInstallDmg` (macOS; sin verificar aquí)

## Contexto

Oracle publica el cliente de Apple Silicon solo como imagen de disco. Los enlaces simbólicos importan: el
centinela `libclntsh.dylib` es un enlace, y el aplanado por basename del zip lo rompería.

## Decisión

1. Se descarga a disco calculando el SHA-256 y se compara con el publicado ANTES de tocar nada: montar bytes
   que no son de Oracle sería darle al parser de imágenes del sistema un fichero de cualquiera. Sin huella
   declarada no se monta.
2. `hdiutil attach -nobrowse -readonly -noautoopen -mountpoint drivers/.montajes/<pack>`, nunca en `/Volumes`:
   solo así el barrido de arranque mira únicamente lo que es de Tessera.
3. Se copian solo las entradas visibles de la raíz con `/bin/cp -R -P -X`: `-P` conserva los enlaces; `-X`
   no copia atributos extendidos ni la cuarentena (los bytes ya los fijan la huella y la firma de Oracle).
4. Se desmonta siempre, en un `finally` (`detach`, y `-force` si falla); un fallo al desmontar no tumba una
   copia buena.
5. Se verifica con `codesign --verify --strict` contra «ancla de Apple y Team ID de Oracle», sobre el binario
   real (`realpath` del enlace). Es la segunda llave: la huella fija el paquete, la firma que la copia conserva
   lo que Oracle firmó.
6. Se copia a `.<pack>.instalando` y solo se renombra a `<pack>` al final: `resolve()` nunca da por instalado
   un directorio a medias. El .dmg se borra siempre.

Nunca se desmonta lo que no es un punto de montaje: hdiutil puede resolver una ruta que no lo es al volumen que
la contiene, y expulsar a la fuerza el disco del usuario si los datos de la app viven en uno externo. Se decide
comparando `st_dev` (con `lstat`) con el de la carpeta padre; si no se puede saber, no se toca nada.

El barrido de arranque (solo Mac) desmonta los montajes colgados y borra `.descargas` y las copias
`.<pack>.instalando`; una instalación espera a que termine.

## Descartes

- `ditto`: copia la raíz entera, puntos incluidos, y con varias fuentes funde el contenido de cada carpeta.
- `xattr -dr` después de copiar, y ejecutar `install_ic.sh` (copia a `~/Downloads` y recoge cualquier otro .dmg).
