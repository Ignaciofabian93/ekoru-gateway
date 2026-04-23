#!/bin/sh
set -e

# Fix ownership of the mounted images volume so appuser can write to it.
# This runs as root before privilege drop.
if [ -d "/app/images" ]; then
  chown -R appuser:appgroup /app/images
fi

# Drop to non-root user and exec the main process
exec su-exec appuser "$@"
