# learnrise-backend

LearnRise backend (FastAPI). Python 3.11.9 only.

Run locally via Docker:

```bash
docker compose run --rm backend pytest -q
```

Health check: `GET /api/health` -> `{"status": "ok"}`.
