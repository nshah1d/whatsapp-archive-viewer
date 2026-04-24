# Security Policy

---

## Threat Model

The WhatsApp Archive Viewer is designed for private, access-controlled deployments. It is not a public-facing web service. The following threat model applies:

| Threat | Mitigation |
|---|---|
| Unauthenticated directory scanning | `scan.php` requires a valid `X-Chronicle-Token` header. All requests without a matching token receive HTTP 403 before any filesystem operations are performed. |
| Search engine indexing of hosted instances | `robots.txt` ships with `User-agent: * / Disallow: /`, blocking all crawlers. |
| Exposure of live credentials in version control | `config.js` and `scan.php` ship with empty token values. A documented pre/post-deployment revert workflow prevents live credentials from being committed. |
| Third-party data exfiltration | The application contains no analytics, no telemetry, no CDN assets, and no external script references of any kind. All resources are self-contained. |
| Message content exposure via `scan.php` | `scan.php` never reads `_chat.txt` content. It returns only folder names and filename inventories. All message parsing is client-side. |

---

## Token Authentication

The `X-Chronicle-Token` mechanism provides a first layer of access control for hosted deployments. It is implemented as follows:

**Server side (`scan.php`, line 2-7):**

```php
define('EXPECTED_TOKEN', 'your-generated-token');
if (!isset($_SERVER['HTTP_X_CHRONICLE_TOKEN']) || $_SERVER['HTTP_X_CHRONICLE_TOKEN'] !== EXPECTED_TOKEN) {
    http_response_code(403);
    echo json_encode(["error" => "Forbidden"]);
    exit;
}
```

All directory scanning logic runs only after this guard passes.

**Client side (`app.js`):**

All `fetch()` calls include the token as a request header:

```javascript
headers: { 'X-Chronicle-Token': SCAN_TOKEN }
```

This covers both the initial `scan.php` request and every subsequent `_chat.txt` fetch.

**Token requirements:**
- Minimum recommended length: 32 hexadecimal characters (128 bits of entropy).
- The token must be set to the same value in both `config.js` (`SCAN_TOKEN`) and `scan.php` (`EXPECTED_TOKEN`).
- Both files ship with empty strings. An empty token causes all requests to fail with HTTP 403. Set a non-empty value before deployment.

**Limitation.** `SCAN_TOKEN` is visible in the browser's JavaScript source to anyone who can load the page. The token provides protection against unauthenticated network access to `scan.php`, not against an already-authenticated user. For deployments where the chat data must be protected from other authenticated users on the same server, place the application behind HTTP Basic Authentication or equivalent server-level access control in addition to the token.

---

## Data Sovereignty

- No message data, metadata, or file content is transmitted to any external server.
- The PHP server's role is limited to two operations: directory listing (via `scan.php`) and static file serving (the `_chat.txt` files and media). Neither operation involves any server-side message processing.
- All parsing, rendering, searching, and media playback are performed entirely in the browser using the Fetch API and the DOM.

---

## `robots.txt`

The included `robots.txt` ships with the following content:

```
User-agent: *
Disallow: /
```

This instructs all compliant web crawlers not to index the application or any of its content. It does not prevent human users or non-compliant bots from accessing the site. For deployments where the data must be strictly private, server-level access control is required.

---

## Credential Management

Two files contain deployment-specific values that must never be committed to a public repository:

| File | Sensitive field | Repository default |
|---|---|---|
| `config.js` | `SCAN_TOKEN` | `''` (empty string) |
| `scan.php` | `EXPECTED_TOKEN` | `''` (empty string) |

Both files are configured with empty defaults. WhatsApp export folders must be added to `.gitignore` manually before committing to any repository.

---

## Reporting Vulnerabilities

To report a security vulnerability, open a private security advisory via the GitHub repository's Security tab, or contact the maintainer directly via the details on [nauman.cc](https://www.nauman.cc).

Please include:
- A description of the vulnerability and the conditions required to trigger it.
- The affected file(s) and, where applicable, the relevant line numbers.
- A proof-of-concept or reproduction steps if available.

Publicly disclosing an unpatched vulnerability before the maintainer has had a reasonable opportunity to respond is not encouraged.

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
