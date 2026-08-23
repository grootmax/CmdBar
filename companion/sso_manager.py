"""
SSO Manager companion module re-exporting app.sso_manager for companion utility usage.
"""

from app.sso_manager import (
    SSO_PROVIDER_PRESETS,
    base64_encode,
    base64_decode,
    generate_pkce,
    resolve_oidc_provider_config,
    generate_oidc_auth_url,
    parse_and_validate_jwt,
    create_saml_request,
    parse_and_validate_saml_response,
    provision_jit_user,
    map_groups_to_permissions,
    filter_categories_for_user,
    SSOSession,
    create_sso_session,
)

__all__ = [
    "SSO_PROVIDER_PRESETS",
    "base64_encode",
    "base64_decode",
    "generate_pkce",
    "resolve_oidc_provider_config",
    "generate_oidc_auth_url",
    "parse_and_validate_jwt",
    "create_saml_request",
    "parse_and_validate_saml_response",
    "provision_jit_user",
    "map_groups_to_permissions",
    "filter_categories_for_user",
    "SSOSession",
    "create_sso_session",
]
