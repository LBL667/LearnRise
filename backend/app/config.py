"""Application settings.

Field names mirror `.env.example` at the repo root (case-insensitive). Unknown
environment variables are ignored so a stale env file never blocks startup.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    provider_profile: str = "local"
    database_url: str = "postgresql+psycopg://learnrise:learnrise@localhost:55432/learnrise"

    app_base_url: str = "http://localhost:5173"
    timezone: str = "Asia/Shanghai"

    llm_provider: str = "openai_compatible"
    llm_base_url: str = "https://api.deepseek.com/v1"
    llm_api_key: str = ""
    llm_model: str = "deepseek-chat"
    llm_fallback_base_url: str = ""
    llm_fallback_api_key: str = ""
    llm_fallback_model: str = ""
    llm_timeout_seconds: float = 60
    llm_max_tokens: int = 2048
    llm_temperature: float = 0.7

    embedding_provider: str = "openai_compatible"
    embedding_base_url: str = "https://api.siliconflow.cn/v1"
    embedding_api_key: str = ""
    embedding_model: str = "bge-m3"
    embedding_dim: int = 1024
    embedding_batch_size: int = 16

    storage_provider: str = "local"
    storage_local_root: str = "var/storage"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"
    minio_bucket: str = "learnrise"
    minio_secure: bool = False

    obs_access_key_id: str = ""
    obs_secret_access_key: str = ""
    obs_endpoint: str = ""
    obs_bucket: str = ""

    ocr_provider: str = "paddle"
    ocr_service_url: str = "http://localhost:8001"
    huawei_ak: str = ""
    huawei_sk: str = ""
    huawei_project_id: str = ""
    huawei_region: str = "cn-north-4"

    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 1440
    agent_secret_key: str = "dev-only-fernet-key-change-me-32bytes="
    agent_request_timeout_seconds: float = 10

    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_use_ssl: bool = True

    cron_signature_secret: str = "dev-only-cron-secret"
    max_upload_mb: int = 20


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
