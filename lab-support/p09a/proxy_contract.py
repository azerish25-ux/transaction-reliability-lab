"""Fixed lab proxy identity, including the listener's actual bound address.

Toxiproxy replaces the requested listener with net.Listener.Addr().String().
Go may report an IPv4 wildcard TCP listener as the IPv6 wildcard [::]. Both
spellings below address this one internal container and this one fixed port.
This is not an arbitrary hostname, address, port or URL allowlist.
"""
from __future__ import annotations


def is_lab_proxy(value: object) -> bool:
    return (isinstance(value, dict)
            and value.get('name') == 'p09a-postgres'
            and value.get('upstream') == 'postgres:5432'
            and isinstance(value.get('listen'), str)
            and value['listen'] in {'0.0.0.0:15432', '[::]:15432'}
            and type(value.get('enabled')) is bool
            and isinstance(value.get('toxics'), list))
