/**
 * Single source of truth for the extension manifest. Chrome and Firefox
 * share everything except the background host and a handful of
 * browser-specific keys; every permission is justified in docs/PERMISSIONS.md.
 */

// Content-Security-Policy for every extension page. 'wasm-unsafe-eval' is the
// minimum needed to instantiate the bundled WebAssembly inference kernels;
// no remote code, no eval, no inline scripts.
const EXTENSION_CSP = "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; base-uri 'none'";

export function createManifest({ target, version, mode }) {
  const isFirefox = target === 'firefox';
  const icons = { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' };

  const manifest = {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: 'Veil',
    description: '__MSG_extDescription__',
    version,
    default_locale: 'en',
    icons,
    action: {
      default_title: '__MSG_actionTitle__',
      default_popup: 'popup.html',
      default_icon: { 16: icons[16], 32: icons[32] },
    },
    options_ui: { page: 'options.html', open_in_tab: true },
    permissions: [
      'storage',
      'declarativeNetRequestWithHostAccess',
      'scripting',
      'contextMenus',
      'alarms',
      ...(isFirefox ? [] : ['offscreen']),
    ],
    host_permissions: ['<all_urls>'],
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        css: ['content.css'],
        run_at: 'document_start',
        all_frames: true,
        match_about_blank: true,
        ...(isFirefox ? {} : { match_origin_as_fallback: true }),
      },
    ],
    web_accessible_resources: [
      {
        // The interstitial is the redirect target for blocked / warned sites.
        resources: ['interstitial.html'],
        matches: ['<all_urls>'],
      },
    ],
    content_security_policy: { extension_pages: EXTENSION_CSP },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+V' },
        description: '__MSG_commandOpenPopup__',
      },
      'toggle-site': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: '__MSG_commandToggleSite__',
      },
      'reveal-focused': {
        suggested_key: { default: 'Alt+Shift+R' },
        description: '__MSG_commandReveal__',
      },
    },
  };

  if (isFirefox) {
    manifest.background = { scripts: ['background.js'], type: 'module' };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'veil@veil-protection.app',
        strict_min_version: '128.0',
        data_collection_permissions: { required: ['none'] },
      },
    };
  } else {
    manifest.background = { service_worker: 'background.js', type: 'module' };
    manifest.minimum_chrome_version = '116';
    manifest.storage = { managed_schema: 'managed_schema.json' };
  }

  if (mode === 'development') {
    manifest.name = 'Veil (Dev)';
  }
  return manifest;
}
