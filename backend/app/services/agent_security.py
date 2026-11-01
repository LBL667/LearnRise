"""Validation of user-supplied LLM ``base_url`` values (SSRF hardening).

The ``base_url`` of an agent is attacker-controlled input that the backend will
later POST a decrypted API key to. That makes it a textbook SSRF vector and a
credential-exfiltration channel. The rules enforced here are deliberately
strict and fail closed:

* only ``https`` (no ``http``, ``file``, ``ftp``, ``gopher`` ...)
* no userinfo (``https://user:pass@host``) — credentials never belong in a URL
* hostname must resolve, and **every** resolved address must be globally
  routable (no loopback, RFC1918, link-local / ``169.254.169.254``, multicast,
  reserved, unspecified, CGNAT, ...)
* non-empty port, 1..65535 (default 443)

Error messages never echo the input URL, so a hostile value cannot be reflected
back through the API or the logs. The resolver is injectable (``_resolve``) so
tests never touch DNS.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable
from typing import Any
from urllib.parse import urlparse, urlunparse

_BAD_URL = "base_url 不合法"

# Explicit belt-and-braces list (also covered by ``is_link_local``); the cloud
# metadata endpoint is the single most valuable SSRF target.
_BLOCKED_LITERALS = frozenset({"169.254.169.254"})

Resolver = Callable[..., list[tuple[Any, ...]]]


def _system_resolver(host: str, port: int, **kwargs: Any) -> list[tuple[Any, ...]]:
    """Default resolver. Patched in tests instead of ``socket.getaddrinfo``.

    Patching ``socket.getaddrinfo`` globally is unsafe here: psycopg resolves
    the database host through it, so a test-wide patch hijacks DB connections.
    """
    return socket.getaddrinfo(host, port, **kwargs)


def _is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return ``True`` for any address the agent backend must never contact."""
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True
    # ``is_global`` additionally rejects CGNAT (100.64/10), documentation
    # ranges, benchmark ranges and other non-routable space.
    if not ip.is_global:
        return True
    return str(ip) in _BLOCKED_LITERALS


def _parse_host(parsed: Any) -> tuple[str, int]:
    """Validate scheme/userinfo/port and return ``(ascii_host, port)``."""
    if parsed.scheme != "https":
        raise ValueError(_BAD_URL)
    if parsed.username is not None or parsed.password is not None:
        raise ValueError(_BAD_URL)
    if parsed.fragment:
        raise ValueError(_BAD_URL)

    host = parsed.hostname
    if not host:
        raise ValueError(_BAD_URL)

    try:
        port = parsed.port
    except ValueError:
        raise ValueError(_BAD_URL) from None
    if port is None:
        port = 443
    if not 1 <= port <= 65535:
        raise ValueError(_BAD_URL)

    try:
        ipaddress.ip_address(host)
        return host, port
    except ValueError:
        pass

    # Host is a DNS name: normalise unicode to its IDNA ASCII form. This also
    # rejects hosts with empty/oversized labels before they reach the resolver.
    try:
        ascii_host = host.encode("idna").decode("ascii")
    except (UnicodeError, UnicodeEncodeError):
        raise ValueError(_BAD_URL) from None
    if not ascii_host:
        raise ValueError(_BAD_URL)
    return ascii_host, port


def validate_base_url(raw: str, *, _resolve: Resolver | None = None) -> str:
    """Validate ``raw`` and return a normalised URL, or raise ``ValueError``.

    The resolver defaults to :func:`socket.getaddrinfo`; tests inject a fake via
    ``_resolve`` so no real DNS query happens. Any resolution failure
    (``socket.gaierror``) is reported as a generic, non-echoing
    :class:`ValueError`.
    """
    resolve: Resolver = _resolve if _resolve is not None else _system_resolver

    candidate = raw.strip()
    if not candidate:
        raise ValueError(_BAD_URL)

    parsed = urlparse(candidate)
    host, port = _parse_host(parsed)

    try:
        records = resolve(host, port, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, OSError, UnicodeError):
        raise ValueError(_BAD_URL) from None
    except Exception:
        raise ValueError(_BAD_URL) from None
    if not records:
        raise ValueError(_BAD_URL)

    for info in records:
        try:
            sockaddr = info[4]
            address = str(sockaddr[0]).split("%")[0]
        except (IndexError, TypeError):
            raise ValueError(_BAD_URL) from None
        try:
            ip = ipaddress.ip_address(address)
        except ValueError:
            raise ValueError(_BAD_URL) from None
        if _is_blocked(ip):
            raise ValueError(_BAD_URL)

    host_for_url = f"[{host}]" if ":" in host else host
    netloc = host_for_url if parsed.port is None else f"{host_for_url}:{port}"
    return urlunparse(("https", netloc, parsed.path.rstrip("/"), parsed.params, parsed.query, ""))
