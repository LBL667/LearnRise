"""Provider-agnostic exception hierarchy.

Adapters raise these instead of leaking SDK exceptions, so callers can handle
failures without importing vendor libraries. Exception messages must never
contain credentials, tokens, or raw provider payloads.
"""

from __future__ import annotations


class ProviderError(Exception):
    """Base class for all provider failures."""


class DimensionMismatch(ProviderError):
    """Embedding dimension does not match the vector store's expectations."""


class ProviderAuthError(ProviderError):
    """Credentials were rejected by the provider."""


class ProviderRateLimitError(ProviderError):
    """The provider throttled the request."""


class UpstreamTimeoutError(ProviderError):
    """The provider did not answer within the configured timeout."""
