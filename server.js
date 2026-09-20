const http = require('http');
const fs = require('fs');
const path = require('path');
const proxyHandler = require('./api/proxy.js');
const chatHandler = require('./api/chat.js');
const studioHandler = require('./api/studio.js');

const PORT = 3000;

const server = http.createServer(async (req, res) => {
    // 1. Route API Proxy, Chat & Studio (Hot-reload in local dev)
    if (req.url.startsWith('/api/proxy')) {
        delete require.cache[require.resolve('./api/proxy.js')];
        return require('./api/proxy.js')(req, res);
    }
    if (req.url.startsWith('/api/chat')) {
        delete require.cache[require.resolve('./api/chat.js')];
        return require('./api/chat.js')(req, res);
    }
    if (req.url.startsWith('/api/studio')) {
        delete require.cache[require.resolve('./api/studio.js')];
        return require('./api/studio.js')(req, res);
    }

    // 2. Static files
    let safeUrl = req.url.split('?')[0];
    if (safeUrl === '/') safeUrl = '/index.html';

    const filePath = path.join(__dirname, decodeURIComponent(safeUrl));

    try {
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' });
            return res.end('404 Not Found');
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html;charset=utf-8',
            '.js': 'text/javascript;charset=utf-8',
            '.css': 'text/css;charset=utf-8',
            '.json': 'application/json;charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        if (req.method === 'HEAD') {
            return res.end();
        }
        const stream = fs.createReadStream(filePath);
        stream.on('error', (e) => {
            if (!res.headersSent) res.writeHead(500);
            res.end('File read error');
        });
        stream.pipe(res);
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain;charset=utf-8' });
        res.end('Server Error: ' + err.message);
    }
});

server.listen(PORT, () => {
    console.log(`Local dev server is running at http://localhost:${PORT}`);
});
