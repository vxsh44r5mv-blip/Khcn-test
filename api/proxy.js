module.exports = async function handler(req, res) {
    // Cho phép gọi cross-origin (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        if (res.status) return res.status(200).end();
        res.writeHead(200);
        return res.end();
    }

    const urlObj = new URL(req.url, 'http://localhost');
    const id = req.query ? req.query.id : urlObj.searchParams.get('id');

    if (!id) {
        if (res.status) return res.status(400).json({ error: 'Thiếu file ID' });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Thiếu file ID' }));
    }

    try {
        const driveUrl = 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(id) + '&export=download&confirm=t';
        const response = await fetch(driveUrl);

        if (!response.ok) {
            const status = response.status;
            if (res.status) return res.status(status).json({ error: 'Google Drive trả về mã: ' + status });
            res.writeHead(status, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Google Drive trả về mã: ' + status }));
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (res.send) {
            return res.send(buffer);
        } else {
            res.writeHead(200);
            return res.end(buffer);
        }
    } catch (err) {
        console.error('Lỗi proxy tải file:', err);
        if (res.status) return res.status(500).json({ error: err.message });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
    }
};
