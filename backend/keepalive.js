const http = require('http');
const https = require('https');

const explicitKeepAliveUrl = process.env.KEEPALIVE_URL || '';
const fallbackKeepAliveUrl = process.env.KEEPALIVE_FALLBACK_URL || '';
const renderExternalUrl = process.env.RENDER_EXTERNAL_URL || '';

const ensureHealthPath = (raw) => {
    const value = (raw || '').trim();
    if (!value) return null;

    try {
        const url = new URL(value);
        if (!url.pathname || url.pathname === '/') {
            url.pathname = '/api/health';
        }
        return url.toString();
    } catch {
        return null;
    }
};

const targets = [
    ...explicitKeepAliveUrl.split(',').map(ensureHealthPath),
    ensureHealthPath(fallbackKeepAliveUrl),
    ensureHealthPath(renderExternalUrl)
].filter(Boolean);

const targetUrls = [...new Set(targets)];

if (targetUrls.length === 0) {
    console.error('No valid keepalive URL provided. Set KEEPALIVE_URL and/or KEEPALIVE_FALLBACK_URL.');
    process.exit(1);
}

const requestWithoutFetch = (targetUrl, timeoutMs = 10000) =>
    new Promise((resolve, reject) => {
        const parsed = new URL(targetUrl);
        const client = parsed.protocol === 'https:' ? https : http;

        const req = client.request(targetUrl, {
            method: 'GET',
            headers: { 'User-Agent': '3Panda-Render-KeepAlive/1.0' }
        }, (res) => {
            res.resume();
            resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                statusText: res.statusMessage || ''
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Request timed out'));
        });

        req.on('error', reject);
        req.end();
    });

const requestWithFallback = async (targetUrl, timeoutMs = 10000) => {
    if (typeof fetch === 'function') {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const res = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'User-Agent': '3Panda-Render-KeepAlive/1.0' },
                signal: controller.signal
            });

            return {
                ok: res.ok,
                status: res.status,
                statusText: res.statusText || ''
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    return requestWithoutFetch(targetUrl, timeoutMs);
};

const ping = async (targetUrl) => {
    const res = await requestWithFallback(targetUrl, 10000);

    if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`.trim());
    }

    console.log(`Keepalive success: ${res.status} ${targetUrl}`);
    return true;
};

(async () => {
    for (const targetUrl of targetUrls) {
        try {
            const ok = await ping(targetUrl);
            if (ok) process.exit(0);
        } catch (err) {
            console.error(`Keepalive failed for ${targetUrl}: ${err.message}`);
        }
    }

    process.exit(1);
})();
