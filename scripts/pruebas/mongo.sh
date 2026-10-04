#!/usr/bin/env bash
# =============================================================================
# MONGODB DE PRUEBAS en Docker: pruebas-mongo en 127.0.0.1:27117.
# Nombre «pruebas-*», NUNCA «tessera-*» (el barrido de Tessera borra esos).
#
# Uso:
#   scripts/pruebas/mongo.sh levantar [--de-cero]   crea o arranca y siembra (idempotente)
#   scripts/pruebas/mongo.sh correr <orden...>       corre la orden con el destino en el entorno
#     p. ej.: scripts/pruebas/mongo.sh correr npm run -s test:db-mongo
#
# POR QUÉ UN REPLICA SET DE UN NODO Y NO UN SERVIDOR SUELTO. Las transacciones de varios
# documentos (el «todo o nada» de «Enviar», D3) SOLO existen en un replica set o un mongos;
# en un servidor suelto el driver 7 falla al primer comando de la transacción con «This
# MongoDB deployment does not support retryable writes», TAMBIÉN con `retryWrites=false`
# (el driver reescribe así el código 20 del servidor; medido, y el mensaje
# engaña: lo que no hay es transacciones). Casi todo Mongo de verdad es un replica set
# (Atlas lo es siempre), así que es la forma que se prueba por defecto; el caso suelto lo
# levanta `levantar-suelto` en 127.0.0.1:27118 para probar el camino degradado.
#
# POR QUÉ EL PUERTO ES EL MISMO DENTRO Y FUERA (27117:27117). Un driver que habla con un
# replica set NO se queda en la dirección que se le dio: lee la lista de miembros del
# servidor y se conecta a ELLOS. Si el miembro se llamara `localhost:27017` dentro del
# contenedor, desde el host se iría a un 27017 que no es este. Con `--port 27117` y el
# miembro `127.0.0.1:27117`, la dirección vale en los dos lados. (En Tessera, lo mismo
# pasa detrás de un túnel o un reenvío de puertos: ahí hace falta `directConnection`.)
#
# Acceso con autenticación y keyFile (el replica set la exige con auth). El primer usuario
# se crea por la «excepción de localhost» desde dentro del contenedor. Usuarios:
#   raiz    root                             (solo para sembrar)
#   tessera readWrite + dbAdmin en `pruebas`
#   lector  read en `pruebas`                (la garantía real del solo lectura)
# Variables que pone `correr` (URI estándar; la clave no lleva caracteres que haya que citar):
#   TESSERA_TEST_MONGO         = mongodb://tessera:<clave>@127.0.0.1:27117/pruebas?authSource=pruebas
#   TESSERA_TEST_MONGO_LECTOR  = mongodb://lector:<clave>@127.0.0.1:27117/pruebas?authSource=pruebas
#   TESSERA_TEST_MONGO_RAIZ    = mongodb://raiz:<clave>@127.0.0.1:27117/?authSource=admin
#   TESSERA_TEST_MONGO_SUELTO  = mongodb://127.0.0.1:27118/pruebas   (sin auth; si está arriba)
# La clave sale de `mongo-pw.txt` (ver comun.sh), se genera si falta y nunca se imprime.
#
# MAC (sin verificar): la imagen oficial `mongo` es multiarquitectura (amd64 y arm64), así
# que en Apple Silicon corre nativa, sin Rosetta.
# =============================================================================
. "$(dirname "${BASH_SOURCE[0]}")/comun.sh"
NOMBRE=pruebas-mongo
PUERTO=27117
NOMBRE_SUELTO=pruebas-mongo-suelto
PUERTO_SUELTO=27118
IMAGEN="${IMAGEN:-mongo:8.0}"
SIEMBRA="$(dirname "${BASH_SOURCE[0]}")/mongo-siembra.js"

# mongosh dentro del contenedor; la clave va por el ENTORNO del exec (process.env.PW).
mongosh_en() {
  local pw="$1"; shift
  MSYS_NO_PATHCONV=1 docker exec -i -e "PW=$pw" "$NOMBRE" mongosh --quiet --port "$PUERTO" "$@"
}

levantar() {
  asegurar_clave mongo-pw.txt
  local pw; pw="$(leer_secreto mongo-pw.txt)" || return 1
  if [ "${1:-}" = "--de-cero" ]; then docker rm -f -v "$NOMBRE" >/dev/null 2>&1; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$NOMBRE"; then
    docker start "$NOMBRE" >/dev/null
  else
    # El keyFile se genera DENTRO al arrancar (no hace falta montarlo): tiene que ser del
    # usuario mongodb y 400, o mongod no arranca.
    MSYS_NO_PATHCONV=1 docker run -d --name "$NOMBRE" \
      -p "127.0.0.1:$PUERTO:$PUERTO" --entrypoint bash "$IMAGEN" -c \
      "[ -s /data/db/kf ] || { openssl rand -base64 756 > /data/db/kf; }; chmod 400 /data/db/kf; chown mongodb /data/db/kf; exec docker-entrypoint.sh mongod --replSet rs0 --keyFile /data/db/kf --bind_ip_all --port $PUERTO" \
      >/dev/null || { echo "no arrancó $NOMBRE"; return 1; }
  fi
  local listo=0
  for i in $(seq 1 60); do
    if mongosh_en "$pw" --eval "db.adminCommand({ping:1}).ok" >/dev/null 2>&1; then listo=1; break; fi
    sleep 2
  done
  [ "$listo" = 1 ] || { echo "$NOMBRE no contesta tras 120 s"; docker logs --tail 20 "$NOMBRE"; return 1; }
  # Replica set y primer usuario por la excepción de localhost (sin usuarios todavía); si
  # ya existen, se entra como raiz. Todo idempotente. La excepción SOLO deja crear el
  # primer usuario: ni siquiera listar los que hay (usersInfo da «not authorized»,
  # medido), así que se intenta crear y, si ya existía, el error se traga.
  mongosh_en "$pw" --eval '
    try { rs.status() } catch (e) {
      if (/no replset config|NotYetInitialized/i.test(String(e.message)))
        rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "127.0.0.1:'"$PUERTO"'" }] })
    }
    for (let i = 0; i < 60 && !db.hello().isWritablePrimary; i++) sleep(500)
    try { db.getSiblingDB("admin").createUser({ user: "raiz", pwd: process.env.PW, roles: ["root"] }) } catch (e) {}
  ' >/dev/null 2>&1
  mongosh_en "$pw" -u raiz -p "$pw" --authenticationDatabase admin < "$SIEMBRA" >/dev/null \
    || { echo "la siembra falló"; return 1; }
  echo "$NOMBRE listo en 127.0.0.1:$PUERTO (replica set rs0; base pruebas; usuarios raiz, tessera, lector)"
}

# Un servidor SUELTO, sin auth ni replica set: solo para medir y probar el camino sin
# transacciones. Efímero a propósito (se borra con `--rm` al pararlo).
levantar_suelto() {
  if ! docker ps --format '{{.Names}}' | grep -qx "$NOMBRE_SUELTO"; then
    MSYS_NO_PATHCONV=1 docker run -d --rm --name "$NOMBRE_SUELTO" \
      -p "127.0.0.1:$PUERTO_SUELTO:27017" "$IMAGEN" >/dev/null || { echo "no arrancó $NOMBRE_SUELTO"; return 1; }
  fi
  local listo=0
  for i in $(seq 1 60); do
    if docker exec "$NOMBRE_SUELTO" mongosh --quiet --eval "db.adminCommand({ping:1}).ok" >/dev/null 2>&1; then listo=1; break; fi
    sleep 2
  done
  [ "$listo" = 1 ] || { echo "$NOMBRE_SUELTO no contesta tras 120 s"; docker logs --tail 20 "$NOMBRE_SUELTO"; return 1; }
  echo "$NOMBRE_SUELTO listo en 127.0.0.1:$PUERTO_SUELTO (suelto, sin auth; se borra al pararlo)"
}

correr() {
  local pw; pw="$(leer_secreto mongo-pw.txt)" || return 1
  cd "$RAIZ_REPO" || return 2
  local suelto=""
  if docker ps --format '{{.Names}}' | grep -qx "$NOMBRE_SUELTO"; then
    suelto="mongodb://127.0.0.1:${PUERTO_SUELTO}/pruebas"
  fi
  TESSERA_TEST_MONGO="mongodb://tessera:${pw}@127.0.0.1:${PUERTO}/pruebas?authSource=pruebas" \
  TESSERA_TEST_MONGO_LECTOR="mongodb://lector:${pw}@127.0.0.1:${PUERTO}/pruebas?authSource=pruebas" \
  TESSERA_TEST_MONGO_RAIZ="mongodb://raiz:${pw}@127.0.0.1:${PUERTO}/?authSource=admin" \
  TESSERA_TEST_MONGO_SUELTO="$suelto" \
    "$@" 2>&1 | sed "s/${pw}/<clave>/g"
  return "${PIPESTATUS[0]}"
}

case "${1:-}" in
  levantar) shift; levantar "$@" ;;
  levantar-suelto) shift; levantar_suelto "$@" ;;
  correr) shift; correr "$@" ;;
  *) echo "uso: mongo.sh levantar [--de-cero] | levantar-suelto | correr <orden...>"; exit 2 ;;
esac
