.PHONY: up down dev test lint demo migrate logs verify compose-check

COMPOSE_FILE ?= docker-compose.yml
export COMPOSE_FILE

up:
	docker compose -f $(COMPOSE_FILE) up -d --build

down:
	docker compose -f $(COMPOSE_FILE) down

dev:
	docker compose -f $(COMPOSE_FILE) up --build

logs:
	docker compose -f $(COMPOSE_FILE) logs -f --tail=200

test:
	docker compose -f $(COMPOSE_FILE) run --rm backend pytest -q

lint:
	docker compose -f $(COMPOSE_FILE) run --rm backend ruff check app tests alembic
	docker compose -f $(COMPOSE_FILE) run --rm backend mypy app

demo:
	docker compose -f $(COMPOSE_FILE) run --rm backend python scripts/seed_demo.py

migrate:
	docker compose -f $(COMPOSE_FILE) run --rm backend alembic upgrade head

# Full pre-commit gate. Run it on a COMMITTED tree: the last step asserts that
# `git status --porcelain` is empty. Nothing here swallows a failure with
# `|| true`; a missing tool prints a loud SKIP with the reason.
verify:
	@set -e; \
	echo "[verify] gate: legacy-name"; \
	bash scripts/check_legacy_name.sh; \
	echo "[verify] gate: adapter-isolation"; \
	bash scripts/check_import_isolation.sh; \
	echo "[verify] ruff"; \
	docker compose -f $(COMPOSE_FILE) run --rm -T --no-deps backend ruff check app tests alembic; \
	echo "[verify] mypy"; \
	docker compose -f $(COMPOSE_FILE) run --rm -T --no-deps backend mypy app; \
	echo "[verify] pytest"; \
	docker compose -f $(COMPOSE_FILE) run --rm -T -v /tmp:/out backend pytest -q --junitxml=/out/junit.xml; \
	echo "[verify] baseline"; \
	bash scripts/compare_test_baseline.sh /tmp/junit.xml; \
	echo "[verify] frontend typecheck + build"; \
	if [ ! -d frontend/node_modules ]; then (cd frontend && npm install --no-audit --no-fund); fi; \
	(cd frontend && npx tsc --noEmit && npm run build); \
	echo "[verify] gitleaks"; \
	if command -v gitleaks >/dev/null 2>&1; then \
		gitleaks detect --no-banner --redact; \
	else \
		echo "[verify] SKIP gitleaks: not installed on this host"; \
	fi; \
	echo "[verify] gate: repo-hygiene (needs a committed tree)"; \
	bash scripts/check_repo_hygiene.sh; \
	echo "[verify] done"

compose-check:
	docker compose -f $(COMPOSE_FILE) config -q
