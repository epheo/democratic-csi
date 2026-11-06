#!/bin/bash
# usage: stop.sh <handle from server.sh>
case $1 in
  '' | *[!0-9]*) podman stop -t 15 "$1" >/dev/null ;;
  *) kill -TERM "$1" ;;
esac
