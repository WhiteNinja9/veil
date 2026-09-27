# Managed deployment (families, schools, organisations)

An in-extension lock only deters casual changes ([SECURITY.md](SECURITY.md#3-someone-at-the-keyboard-trying-to-turn-protection-off)).
Where Veil must stay on, use the browser's own policy system to:

1. **force-install** Veil, so it cannot be removed or disabled;
2. **pin Veil's settings** through managed storage;
3. **close the side doors:** private windows, developer tools, other browsers and profiles.

Policies flow _into_ Veil only. Veil has no reporting channel, so administrators cannot see what
anyone browsed or what was protected ([PRIVACY.md](PRIVACY.md)).

## Veil's managed settings

| Key                 | Type                                                     | Effect                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enforceEnabled`    | boolean                                                  | Protection stays on. _Turn off_ and _Pause_ are unavailable.                                                                                                                  |
| `minimumStrictness` | `"minimal"` \| `"balanced"` \| `"strict"` \| `"maximum"` | The level can't go below this. Users may still choose a stricter one.                                                                                                         |
| `strictBrowsing`    | boolean                                                  | Strict Browsing on, with all of its parts: SafeSearch, YouTube Restricted Mode, ignoring site exceptions, reveal at least _hold_ with confirmation, and a _protect_ fallback. |
| `revealMode`        | `"click"` \| `"hold"` \| `"hover"` \| `"disabled"`       | Fixes how protected media can be revealed. `"disabled"` means never.                                                                                                          |

The schema ships as `managed_schema.json` (Chrome). Policy is applied as an overlay every time
settings are read or written, so a user change can't take effect underneath it. Settings shows
managed controls as locked, with a _Managed_ label.

Not yet manageable: site rules and category thresholds.

## Chrome and Edge

The extension ID is assigned by the Chrome Web Store (or derived from your packing key for
self-hosting). It appears below as `EXTENSION_ID`.

### Force-install

```json
{
  "ExtensionInstallForcelist": ["EXTENSION_ID;https://clients2.google.com/service/update2/crx"]
}
```

### Veil settings (managed storage)

**Linux**: `/etc/opt/chrome/policies/managed/veil.json`

```json
{
  "3rdparty": {
    "extensions": {
      "EXTENSION_ID": {
        "enforceEnabled": true,
        "minimumStrictness": "strict",
        "strictBrowsing": true,
        "revealMode": "hold"
      }
    }
  }
}
```

**Windows** (registry, or the equivalent Group Policy):
`HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\EXTENSION_ID\policy`, with `REG_DWORD`
`enforceEnabled = 1`, `REG_SZ` `minimumStrictness = strict`, and so on. Edge uses
`HKLM\Software\Policies\Microsoft\Edge\3rdparty\extensions\EXTENSION_ID\policy`.

**macOS**: a configuration profile for the domain `com.google.Chrome.extensions.EXTENSION_ID`
with the same keys.

**Google Admin console**: Devices → Chrome → Apps & extensions → select Veil → _Policy for
extensions_ → paste the inner JSON object.

### Side doors

| Policy                                                | Value   | Why                                                       |
| ----------------------------------------------------- | ------- | --------------------------------------------------------- |
| `IncognitoModeAvailability`                           | `1`     | Disables Incognito, where extensions don't run by default |
| `DeveloperToolsAvailability`                          | `2`     | Stops editing Veil's storage from DevTools                |
| `BrowserAddPersonEnabled` / `BrowserGuestModeEnabled` | `false` | No fresh profiles without Veil                            |

Verify at `chrome://policy`: Veil's keys appear under _Extension policies_. Changes apply within
seconds; Veil re-reads managed storage when it changes.

## Firefox

Use `policies.json` (in the `distribution` folder of the Firefox installation) or the equivalent
Group Policy / macOS profile. The add-on ID is `veil@veil-protection.app`.

```json
{
  "policies": {
    "ExtensionSettings": {
      "veil@veil-protection.app": {
        "installation_mode": "force_installed",
        "install_url": "https://addons.mozilla.org/firefox/downloads/latest/veil@veil-protection.app/latest.xpi",
        "private_browsing": true
      }
    },
    "3rdparty": {
      "Extensions": {
        "veil@veil-protection.app": {
          "enforceEnabled": true,
          "minimumStrictness": "strict",
          "strictBrowsing": true,
          "revealMode": "hold"
        }
      }
    },
    "DisableDeveloperTools": true
  }
}
```

`private_browsing: true` lets Veil run in private windows. Alternatively, disable them with
`"DisablePrivateBrowsing": true`. Verify at `about:policies`.

The `install_url` above is where AMO would serve the add-on once it is listed there. For a
self-hosted build, point it at your signed `.xpi`.

## Family setups without enterprise tools

On a personal computer you can still get most of the way:

1. Install Veil and complete onboarding at your chosen level.
2. Settings → Advanced → **Lock**: set a passcode covering settings, turning off and site
   exceptions.
3. Turn on **Strict Browsing**.
4. Chrome: in `chrome://extensions` → Veil → _Details_, check whether _Allow in Incognito_ should be
   on, or disable Incognito for that account with OS parental controls. Firefox: allow Veil in
   private windows (Add-ons → Veil → _Run in Private Windows_).
5. Use the operating system's parental controls (Screen Time, Microsoft Family, and so on) to
   restrict installing other browsers.

Be open with the people you set this up for: Veil is a tool for agreed choices, and it works
best that way.
