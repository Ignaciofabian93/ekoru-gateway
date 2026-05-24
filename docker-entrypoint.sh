#!/bin/sh
set -e

# Drop to non-root user and exec the main process
exec su-exec appuser "$@"
