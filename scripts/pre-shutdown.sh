#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
BACKUP_SCRIPT="${BACKUP_SCRIPT:-${ROOT_DIR}/infra/k8s/backup.sh}"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"
MAX_AGE_SECONDS="${MAX_AGE_SECONDS:-600}"

if [[ ! -x "${BACKUP_SCRIPT}" ]]; then
  echo "[error] backup script not executable: ${BACKUP_SCRIPT}"
  exit 1
fi

echo "[run] backup"
"${BACKUP_SCRIPT}"

echo "[run] verify freshness"
python3 - <<PY
from pathlib import Path
import time
import json
import sys

backup_dir = Path(${BACKUP_DIR@Q})
max_age = int(${MAX_AGE_SECONDS@Q})

if not backup_dir.exists():
    print('[error] backup dir missing:', backup_dir)
    sys.exit(1)

latest_mtime = 0.0
latest_path = None
file_count = 0

for p in backup_dir.rglob('*'):
    if p.is_file():
        file_count += 1
        m = p.stat().st_mtime
        if m > latest_mtime:
            latest_mtime = m
            latest_path = p

if file_count == 0 or latest_path is None:
    print('[error] no backup files found')
    sys.exit(1)

age = time.time() - latest_mtime
out = {
    'backup_dir': str(backup_dir),
    'latest_file': str(latest_path),
    'latest_age_seconds': round(age, 2),
    'file_count': file_count,
}
print(json.dumps(out, ensure_ascii=False, indent=2))

if age > max_age:
    print(f'[error] latest backup is too old (> {max_age}s)')
    sys.exit(1)
PY

echo "[done] backup verified; safe to stop Docker"
