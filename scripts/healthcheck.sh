#!/usr/bin/env bash
set -e
curl -sf http://localhost:5050/health >/dev/null
curl -sf http://localhost:5050/ready >/dev/null
echo "OK"
