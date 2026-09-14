const fs = require('fs');
const path = require('path');

// Đọc API Key từ biến môi trường Vercel hoặc fallback mã hóa
function resolveApiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    try {
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            const lines = fs.readFileSync(envPath, 'utf8').split('\n');
            for (const line of lines) {
                const parts = line.split('=');
                if (parts[0].trim() === 'GEMINI_API_KEY') {
                    return parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                }
            }
        }
    } catch (e) {}
    // Dự phòng khi chạy trên cloud chưa set env
    const enc = 'QVEuQWI4Uk42SURjWUd5SEZuMEJRdTVWdFRmMTVvMzE0bHo5dHplUE1iQTBoa3h4cThxekE=';
    return Buffer.from(enc, 'base64').toString('utf8');
}

const GEMINI_MODEL = 'gemini-2.5-flash';

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        if (res.status) return res.status(200).end();
        res.writeHead(200);
        return res.end();
    }

    if (req.method !== 'POST') {
        if (res.status) return res.status(405).json({ error: 'Method Not Allowed' });
        res.writeHead(405, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    }

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
    }

    if (!body) {
        body = await new Promise((resolve) => {
            let data = '';
            req.on('data', chunk => { data += chunk; });
            req.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
            });
        });
    }

    const { message, imageBase64, mimeType, history } = body || {};

    if (!message && !imageBase64) {
        const errObj = { status: 'error', message: 'Nội dung tin nhắn trống' };
        if (res.status) return res.status(400).json(errObj);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(errObj));
    }

    try {
        const apiKey = resolveApiKey();
        const contents = [];
        const systemInstruction = {
            parts: [{
                text: 'Bạn là Chat Pro - trợ lý AI thông minh hỗ trợ quản lý công việc và báo cáo nhiệm vụ khoa học công nghệ (KHCN). Hãy trả lời ngắn gọn, thân thiện, súc tích và hỗ trợ người dùng chu đáo bằng tiếng Việt.'
            }]
        };

        if (Array.isArray(history)) {
            history.forEach(h => {
                if (h.role && h.parts) {
                    const role = h.role === 'user' ? 'user' : 'model';
                    contents.push({ role, parts: h.parts });
                }
            });
        }

        const currentParts = [];
        if (imageBase64) {
            currentParts.push({
                inline_data: {
                    mime_type: mimeType || 'image/jpeg',
                    data: imageBase64
                }
            });
        }
        if (message) {
            currentParts.push({ text: message });
        }

        contents.push({ role: 'user', parts: currentParts });

        const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
        const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: systemInstruction,
                contents: contents
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || ('Gemini API error ' + response.status));
        }

        const data = await response.json();
        const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Không nhận được phản hồi từ AI.';

        const result = { status: 'success', reply: replyText };

        if (res.status) return res.status(200).json(result);
        res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
        return res.end(JSON.stringify(result));
    } catch (err) {
        console.error('Lỗi Gemini Chat:', err);
        const errRes = { status: 'error', message: err.message };
        if (res.status) return res.status(500).json(errRes);
        res.writeHead(500, { 'Content-Type': 'application/json;charset=utf-8' });
        return res.end(JSON.stringify(errRes));
    }
};
