# Configuration Reference

This document covers every configurable value in the WhatsApp Archive Viewer, token generation, and the steps required for local and hosted deployment.

---

## `config.js`

This file is the sole user-editable configuration file on the client side. It exports two constants consumed by `app.js`.

```javascript
export const MY_NAME = "Your Name";
export const SCAN_TOKEN = 'your-generated-token';
```

| Constant | Type | Description |
|---|---|---|
| `MY_NAME` | `string` | The display name as it appears in `_chat.txt` for outgoing messages. Must be an exact character-for-character match, including capitalisation and spaces. |
| `SCAN_TOKEN` | `string` | The authentication token sent as the `X-Chronicle-Token` HTTP header on every `fetch()` call to `scan.php` and every `_chat.txt` request. Must match `EXPECTED_TOKEN` in `scan.php`. |

**How `MY_NAME` is used.** The parser checks `msg.sender.includes(MY_NAME)` on every message. Messages where this evaluates to `true` are rendered as outgoing bubbles (right-aligned, distinct colour). All others are rendered as incoming. If `MY_NAME` is wrong or empty, all messages will appear as incoming.

**Repository default.** `config.js` ships with `MY_NAME = "John Doe"` and `SCAN_TOKEN = ''`. These are safe, anonymous defaults. Set both fields before use.

---

## `scan.php`

The server-side authentication constant is defined on line 2:

```php
define('EXPECTED_TOKEN', 'your-generated-token');
```

| Constant | Type | Description |
|---|---|---|
| `EXPECTED_TOKEN` | `string` | Compared against the `X-Chronicle-Token` header on every incoming request. Requests with a missing or mismatched header receive HTTP 403. |

**Repository default.** `scan.php` ships with `define('EXPECTED_TOKEN', '')`. An empty token will cause all requests to fail because `scan.php` evaluates an empty `EXPECTED_TOKEN` against an empty header and returns 403. Set it to a non-empty value matching `SCAN_TOKEN` in `config.js`.

---

## Token Generation

The token is a shared secret. Any sufficiently random string works. The following commands produce a 32-character hex string (128 bits of entropy):

```bash
# Linux / macOS
openssl rand -hex 16
```

```powershell
# Windows (PowerShell)
[System.BitConverter]::ToString(
  [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
).Replace("-","").ToLower()
```

**Minimum recommended length:** 32 hexadecimal characters (128-bit). Shorter tokens are functional but offer reduced protection against brute-force guessing on publicly hosted deployments.

---

## Performance Constants

These constants are defined in `app.js` (lines 5-7) and are not intended to be user-configurable without understanding the trade-offs. They govern the virtual DOM windowing system.

```javascript
const MSG_CHUNK_SIZE = 50;
const MEDIA_CHUNK_SIZE = 30;
const MAX_DOM_MSGS = 200;
```

| Constant | Default | Effect of increasing | Effect of decreasing |
|---|---|---|---|
| `MSG_CHUNK_SIZE` | 50 | More messages loaded per scroll event. Slower per scroll trigger, fewer triggers overall. | Faster per scroll trigger, more frequent DOM updates. |
| `MAX_DOM_MSGS` | 200 | More nodes in the DOM simultaneously. Higher memory use, smoother rendering. | Lower memory use, more frequent pruning. |
| `MEDIA_CHUNK_SIZE` | 30 | More media items per drawer scroll. | Fewer items per scroll trigger in the media drawer. |

These values are calibrated for archives up to 500,000 messages on typical consumer hardware. Adjust only after performance profiling on a real large archive.

---

## Local Deployment

For local use, the PHP built-in server is the simplest option:

```bash
cd /path/to/whatsapp-archive-viewer
php -S localhost:8000
```

Open `http://localhost:8000` in any modern browser.

**Prerequisites:** PHP 8.0 or later must be installed and accessible on the system `PATH`. Verify with `php --version`.

---

## Hosted Deployment

To deploy on any PHP-enabled shared hosting provider or VPS:

**Files to upload (exactly these six):**
- `app.js`
- `config.js`
- `index.html`
- `robots.txt`
- `scan.php`
- `style.css`

**Do not upload:**
- `docs/` (optional; no runtime dependency)
- `README.md`, `SECURITY.md`, `LICENSE` (optional; no runtime dependency)
- Any WhatsApp export folders containing personal chat data, unless the deployment is intentionally private and access-controlled via the token.

**Pre-upload checklist:**

1. Set `SCAN_TOKEN` in `config.js` to the live token value.
2. Set `EXPECTED_TOKEN` in `scan.php` to the same live token value.
3. Set `MY_NAME` in `config.js` to the correct display name.
4. Set the seven metadata fields in `index.html` to live values:
   - `og:url`
   - `og:image`
   - `og:site_name`
   - `twitter:url`
   - `twitter:image`
   - `link rel="icon"`
   - `link rel="apple-touch-icon"`

**Post-upload revert (local files only):**

After confirming the deployment is live, revert all three files to their anonymous defaults in the local repository:

- `config.js`: `MY_NAME = "John Doe"`, `SCAN_TOKEN = ''`
- `scan.php`: `EXPECTED_TOKEN = ''`
- `index.html`: all seven fields to placeholder values

This ensures no live credentials or personal data are committed to version control.

---

## `.gitignore` Reference

The included `.gitignore` excludes OS-generated metadata files:

| Pattern | Reason |
|---|---|
| `*.DS_Store`, `Thumbs.db`, `desktop.ini` | OS-generated metadata files. |

WhatsApp export folders are not listed in `.gitignore` by default because their names are user-defined. Add each folder name manually to prevent committing personal chat data:

```gitignore
# Personal chat data — do not commit
Alice Export/
Family Group/
```

---

<div align="center">
<br>

**_Architected by Nauman Shahid_**

<br>

[![Portfolio](https://img.shields.io/badge/Portfolio-nauman.cc-000000?style=for-the-badge&logo=googlechrome&logoColor=white)](https://www.nauman.cc)
[![GitHub](https://img.shields.io/badge/GitHub-nshah1d-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/nshah1d)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/nshah1d/)

</div>
<br>

Licensed under the [MIT Licence](LICENSE).
