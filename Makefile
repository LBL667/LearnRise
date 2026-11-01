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
	bash scripts/demo.sh

migrate:
	docker compose -f $(COMPOSE_FILE) run --rm backend alembic upgrade head

# Full pre-commit gate: ruff + mypy + pytest + vitest + build + playwright + gitleaks.
# A missing tool prints a loud SKIP line with the reason instead of silently
# passing; any real failure makes the target exit non-zero.
#
# Playwright runs the four functional E2E specs (login, upload, quiz, agents)
# against the compose stack: frontend on E2E_BASE_URL (default
# http://localhost:5173) and backend on E2E_API_URL (default
# http://localhost:8000). frontend/playwright.config.ts sets
# reuseExistingServer: true, so the spec suite reuses the running compose
# `frontend` container instead of spawning a second dev server on 5173; stop
# that container first if you would rather let Playwright boot its own.
# e2e/record.spec.ts is deliberately excluded: it is the demo-video recorder
# (separate playwright.record.config.ts) and overwrites submission assets.
#
# If the stack is unreachable the playwright step FAILS by default. Set
# VERIFY_ALLOW_SKIP=1 to downgrade it to "SKIP: stack not reachable" on
# machines without Docker. CI must NOT set that flag: a green `make verify`
# has to mean the E2E suite actually ran.
verify:
	@set -e; \
	echo "[verify] ruff"; \
	if docker compose -f $(COMPOSE_FILE) run --rm -T --no-deps backend sh -c 'command -v ruff >/dev/null 2>&1'; then \
		docker compose -f $(COMPOSE_FILE) run --rm -T --no-deps backend ruff check app tests alembic; \
	else \
		echo "[verify] SKIP ruff: ruff not available in the backend image"; \
	fi
	@set -e; \
	echo "[verify] mypy"; \
	if docker compose -f $(COMPOSE_FILE) run --rm -T --no-deps backend sh -c 'command -v mypy >/dev/null 2>&1'; then \
		docker compose -f $(COMPOSE_FILE) run --rm -T --no-deps backend mypy app; \
	else \
		echo "[verify] SKIP mypy: mypy not available in the backend image"; \
	fi
	@set -e; \
	echo "[verify] pytest"; \
	if docker compose -f $(COMPOSE_FILE) run --rm -T --no-deps backend sh -c 'command -v pytest >/dev/null 2>&1'; then \
		docker compose -f $(COMPOSE_FILE) run --rm -T backend pytest -q; \
	else \
		echo "[verify] SKIP pytest: pytest not available in the backend image"; \
	fi
	@set -e; \
	echo "[verify] vitest"; \
	if ! command -v npm >/dev/null 2>&1; then \
		echo "[verify] SKIP vitest: npm not installed on this host"; \
	elif [ ! -d frontend/node_modules ]; then \
		echo "[verify] frontend/node_modules missing; running npm ci"; \
		cd frontend && npm ci && npm run test; \
	else \
		cd frontend && npm run test; \
	fi
	@set -e; \
	echo "[verify] frontend build"; \
	if ! command -v npm >/dev/null 2>&1; then \
		echo "[verify] SKIP build: npm not installed on this host"; \
	else \
		cd frontend && npm run build; \
	fi
	@set -e; \
	echo "[verify] playwright e2e"; \
	BASE_URL="$${E2E_BASE_URL:-http://localhost:5173}"; \
	API_URL="$${E2E_API_URL:-http://localhost:8000}"; \
	if ! command -v npm >/dev/null 2>&1; then \
		if [ "$${VERIFY_ALLOW_SKIP:-0}" = "1" ]; then \
			echo "[verify] SKIP playwright: npm not installed on this host (VERIFY_ALLOW_SKIP=1)"; \
		else \
			echo "[verify] FAIL playwright: npm not installed; set VERIFY_ALLOW_SKIP=1 to skip" >&2; \
			exit 1; \
		fi; \
	elif [ ! -x frontend/node_modules/.bin/playwright ]; then \
		if [ "$${VERIFY_ALLOW_SKIP:-0}" = "1" ]; then \
			echo "[verify] SKIP playwright: frontend dependencies not installed (VERIFY_ALLOW_SKIP=1)"; \
		else \
			echo "[verify] FAIL playwright: frontend/node_modules/.bin/playwright missing; run 'make verify' after 'cd frontend && npm ci', or set VERIFY_ALLOW_SKIP=1 to skip" >&2; \
			exit 1; \
		fi; \
	elif ! curl -fsS -m 3 -o /dev/null "$$API_URL/api/health" 2>/dev/null \
		|| ! curl -fsS -m 3 -o /dev/null "$$BASE_URL/" 2>/dev/null; then \
		if [ "$${VERIFY_ALLOW_SKIP:-0}" = "1" ]; then \
			echo "[verify] SKIP playwright: stack not reachable (backend $$API_URL, frontend $$BASE_URL)"; \
		else \
			echo "[verify] FAIL playwright: stack not reachable (backend $$API_URL, frontend $$BASE_URL); run 'docker compose -f $(COMPOSE_FILE) up -d' or set VERIFY_ALLOW_SKIP=1 to skip" >&2; \
			exit 1; \
		fi; \
	else \
		cd frontend && E2E_BACKEND=1 E2E_BASE_URL="$$BASE_URL" E2E_API_URL="$$API_URL" \
			npx playwright test e2e/login.spec.ts e2e/upload.spec.ts e2e/quiz.spec.ts e2e/agents.spec.ts; \
	fi
	@set -e; \
	echo "[verify] gitleaks"; \
	if command -v gitleaks >/dev/null 2>&1; then \
		gitleaks detect --no-banner --redact; \
	else \
		echo "[verify] SKIP gitleaks: gitleaks not installed (see .pre-commit-config.yaml)"; \
	fi
	@echo "[verify] done"

compose-check:
	docker compose -f $(COMPOSE_FILE) config -q
