/**
 * Outbound HTTP for the market's own server-side calls.
 *
 * Uses Node's global `fetch`. The original implementation routed through
 * undici's EnvHttpProxyAgent to honor HTTP_PROXY/HTTPS_PROXY; that
 * dependency was dropped to keep the plugin self-contained (vendored deps
 * are copied into every install). Trade-off: on a machine whose only route
 * out is a proxy, the catalog fetch will fail — Node's global fetch ignores
 * proxy environment variables.
 */
/**
 * The proxy this process would use for the catalog, if any. Kept for
 * diagnostics only: the failure message reports what was configured, even
 * though it is no longer actually used.
 */
export function configuredProxy() {
    const { http, https } = proxyFromEnv();
    return https ?? http;
}
/**
 * Proxy URLs resolved from the process environment, standard variables
 * first and npm's own config (`npm_config_https_proxy` / `npm_config_proxy`)
 * as the fallback.
 */
function proxyFromEnv() {
    const pick = (raw) => raw === undefined || raw.trim() === '' ? null : raw.trim();
    const https = pick(process.env.https_proxy ?? process.env.HTTPS_PROXY) ??
        pick(process.env.npm_config_https_proxy);
    const http = pick(process.env.http_proxy ?? process.env.HTTP_PROXY) ??
        pick(process.env.npm_config_proxy);
    return { http, https };
}
/**
 * Fetch through Node's global `fetch`. Proxy environment variables are NOT
 * honored here (see the module doc): this is the deliberate trade-off for
 * dropping the undici dependency.
 */
export async function marketFetch(url, init) {
    return await fetch(url, init);
}
