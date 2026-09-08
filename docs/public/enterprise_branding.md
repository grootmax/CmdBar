# Enterprise Custom Branding & White Label Guide

CmdBar Enterprise provides comprehensive white label custom branding options, allowing organizations to customize the top panel indicator, companion desktop application, domain alias routing, and custom SSL/TLS certificate verification.

## White Label Configuration

White label features can be enabled and configured in `config.json` under the `branding` block or through GNOME Shell extension preferences.

### Schema Example (`config.json`)

```json
{
  "branding": {
    "enabled": true,
    "white_label": true,
    "organization_name": "Acme Enterprise Commands",
    "logo_url": "https://internal.acme.corp/logo.png",
    "logo_path": "/usr/share/pixmaps/acme-logo.png",
    "brand_color": "#0055ff",
    "accent_color": "#00aaff",
    "domain_alias": "cmdbar.acme.internal",
    "custom_ssl": {
      "cert_path": "/etc/ssl/certs/acme.crt",
      "key_path": "/etc/ssl/private/acme.key",
      "ca_path": "/etc/ssl/certs/ca-bundle.crt",
      "verify_ssl": true
    }
  }
}
```

### Key Parameters

- **`enabled` / `white_label`** (`boolean`): Toggles white label custom branding on or off.
- **`organization_name`** (`string`): The corporate or organization name used across top panel tooltips, notifications, and application window titles.
- **`logo_url` / `logo_path`** (`string`): Custom logo image path or URL for branding identity.
- **`brand_color` & `accent_color`** (`string`): Primary and accent hex colors applied to GTK UI headers, buttons, and status indicators.
- **`domain_alias`** (`string`): Custom internal domain alias or endpoint prefix for routing enterprise AI and backend service requests.
- **`custom_ssl`** (`object`): Enterprise TLS configuration including custom CA bundle (`ca_path`), client certificate (`cert_path`), private key (`key_path`), and TLS verification toggle (`verify_ssl`).

## GNOME Shell Extension Preferences

Enterprise administrators and users can also toggle white label options directly via GNOME Preferences (`extension/prefs.js`):
1. Open GNOME Extensions settings for **CmdBar**.
2. Navigate to **Enterprise Custom Branding (White Label)**.
3. Toggle **Enable White Label**, set **Organization Name**, **Brand Color**, **Domain Alias**, and **Custom SSL Certificate Path**.
