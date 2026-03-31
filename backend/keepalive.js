const targetUrl = process.env.KEEPALIVE_URL;

if (!targetUrl) {
    console.error('KEEPALIVE_URL is required. Example: https://your-app.onrender.com/api/health');
    process.exit(1);
}

(async () => {
    try {
        const res = await fetch(targetUrl, {
            method: 'GET',
            headers: { 'User-Agent': '3Panda-Render-KeepAlive/1.0' }
        });

        if (!res.ok) {
            console.error(`Keepalive failed: ${res.status} ${res.statusText}`);
            process.exit(1);
        }

        console.log(`Keepalive success: ${res.status} ${targetUrl}`);
        process.exit(0);
    } catch (err) {
        console.error('Keepalive error:', err.message);
        process.exit(1);
    }
})();
