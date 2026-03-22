.PHONY: k8s-backup k8s-backup-verify k8s-restore k8s-restore-fast k8s-verify

k8s-backup:
	./infra/k8s/backup.sh

k8s-backup-verify:
	./infra/k8s/backup.sh --verify-only

k8s-restore:
	./infra/k8s/restore.sh

k8s-restore-fast:
	./infra/k8s/restore.sh --skip-recreate --skip-serving

k8s-verify:
	./infra/k8s/restore.sh --verify-only
