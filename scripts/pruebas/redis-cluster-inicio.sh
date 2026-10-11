#!/bin/sh
# =============================================================================
# Arranque DENTRO del contenedor pruebas-redis-cluster (lo copia y lanza `redis.sh levantar-cluster`):
# seis nodos (6491-6496) de un Cluster con tres maestros y una réplica por maestro. Todos se anuncian
# como 127.0.0.1: la topología que da CLUSTER SLOTS es alcanzable tal cual desde el anfitrión. El
# cluster se crea la primera vez; al rearrancar, cada nodo recupera su `nodes-*.conf`.
# La clave llega por el entorno (PW) y nunca se imprime.
# =============================================================================
set -e
D=/datos
mkdir -p "$D"
PUERTOS="6491 6492 6493 6494 6495 6496"
nuevo=0
[ -f "$D/nodes-6491.conf" ] || nuevo=1

for p in $PUERTOS; do
  redis-server --port "$p" --cluster-enabled yes --cluster-config-file "$D/nodes-$p.conf" \
    --cluster-node-timeout 5000 --cluster-announce-ip 127.0.0.1 \
    --requirepass "$PW" --masterauth "$PW" --appendonly no --save '' \
    --daemonize yes --logfile "$D/n$p.log"
done
for p in $PUERTOS; do
  i=0
  until REDISCLI_AUTH="$PW" redis-cli -p "$p" PING >/dev/null 2>&1; do
    i=$((i + 1)); [ "$i" -gt 30 ] && exit 1; sleep 1
  done
done
if [ "$nuevo" = 1 ]; then
  REDISCLI_AUTH="$PW" redis-cli --cluster create \
    127.0.0.1:6491 127.0.0.1:6492 127.0.0.1:6493 127.0.0.1:6494 127.0.0.1:6495 127.0.0.1:6496 \
    --cluster-replicas 1 --cluster-yes >"$D/crear.log" 2>&1
fi
exec tail -f /dev/null
