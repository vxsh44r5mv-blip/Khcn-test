const fs = require('fs');
const path = require('path');

// Đọc API Key từ .env hoặc fallback
function resolveApiKey() {
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
    try {
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
            for (const line of lines) {
                const parts = line.split('=');
                if (parts[0].trim() === 'GEMINI_API_KEY') {
                    return parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                }
            }
        }
    } catch (e) {}
    const enc = 'QVEuQWI4Uk42SURjWUd5SEZuMEJRdTVWdFRmMTVvMzE0bHo5dHplUE1iQTBoa3h4cThxekE=';
    return Buffer.from(enc, 'base64').toString('utf8');
}

// Fallback models if gemini-3.1-pro hits quota limit
const CANDIDATE_MODELS = [
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-3.1-pro-preview'
];

async function callGemini(contents, systemInstruction, temperature = 0.2) {
    const apiKey = resolveApiKey();
    let lastError = null;

    for (const model of CANDIDATE_MODELS) {
        try {
            const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey;
            const bodyPayload = {
                contents: contents,
                generationConfig: {
                    temperature: temperature
                }
            };
            if (systemInstruction) {
                bodyPayload.system_instruction = {
                    parts: [{ text: systemInstruction }]
                };
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });

            if (response.ok) {
                const data = await response.json();
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    return { text, modelUsed: model };
                }
            } else {
                const errData = await response.json().catch(() => ({}));
                const msg = errData.error?.message || ('HTTP ' + response.status);
                console.warn('Gemini model ' + model + ' returned error: ' + msg);
                lastError = new Error(model + ': ' + msg);
            }
        } catch (err) {
            console.warn('Gemini model ' + model + ' exception: ' + err.message);
            lastError = err;
        }
    }

    throw lastError || new Error('Không thể kết nối tới Google Gemini API');
}

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
            const chunks = [];
            req.on('data', chunk => { chunks.push(chunk); });
            req.on('end', () => {
                try {
                    const str = Buffer.concat(chunks).toString('utf8');
                    resolve(JSON.parse(str));
                } catch (e) {
                    resolve({});
                }
            });
            req.on('error', () => resolve({}));
        });
    }

    const { action, imageBase64, mimeType, oldText, newText, promptText } = body || {};

    try {
        if (!imageBase64 && !body.pdfBase64) {
            throw new Error('Chưa cung cấp dữ liệu hình ảnh hoặc file PDF.');
        }

        // 1. ACTION: OCR & CONVERT TO DOCX HTML
        if (action === 'ocr_docx') {
            const systemPrompt = `Bạn là chuyên gia trích xuất tài liệu văn bản, hình ảnh, trang sách, biểu mẫu sang Word (.docx).
Nhiệm vụ của bạn là nhận diện chính xác 100% nội dung chữ, cấu trúc tiêu đề, đoạn văn và bảng biểu của tài liệu trong ảnh/PDF để trả về mã HTML sạch (semantic HTML).
Quy tắc định dạng:
1. Tiêu đề lớn dùng <h1>, tiêu đề phụ dùng <h2>, mục nhỏ dùng <h3>.
2. Đoạn văn dùng thẻ <p>.
3. In đậm dùng <b>, in nghiêng <i>, gạch chân <u> đúng theo bản gốc.
4. Với bảng biểu, tạo đúng chuẩn HTML:
   <table>
     <thead><tr><th>Tiêu đề cột 1</th><th>Tiêu đề cột 2</th></tr></thead>
     <tbody><tr><td>Ô 1</td><td>Ô 2</td></tr></tbody>
   </table>
5. Với danh sách liệt kê, dùng <ul><li> hoặc <ol><li>.
6. Cố gắng giữ trật tự và độ chính xác tối đa của ký tự tiếng Việt.
7. QUAN TRỌNG: Chỉ trả về nội dung HTML thuần túy. Tuyệt đối KHÔNG bọc mã trong markdown \`\`\`html và không thêm văn bản giải thích.`;

            const contents = [{
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: mimeType || 'image/jpeg',
                            data: imageBase64 || body.pdfBase64
                        }
                    },
                    {
                        text: 'Hãy trích xuất toàn bộ tài liệu này thành mã HTML sạch để đưa vào tài liệu Word (.docx).'
                    }
                ]
            }];

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1);
            let cleanedHtml = text.trim();
            if (cleanedHtml.startsWith('```html')) {
                cleanedHtml = cleanedHtml.replace(/^```html\s*/i, '').replace(/\s*```$/, '');
            } else if (cleanedHtml.startsWith('```')) {
                cleanedHtml = cleanedHtml.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            const result = { status: 'success', html: cleanedHtml, modelUsed };
            if (res.status) return res.status(200).json(result);
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // 2. ACTION: AI EDIT TEXT (THAY THẾ CHỮ TRÊN ẢNH GIỮ NỀN)
        if (action === 'ai_edit_text') {
            if (!oldText) throw new Error('Vui lòng nhập chữ/thông tin cần thay thế (oldText).');

            const systemPrompt = `Bạn là chuyên gia phân tích ảnh đồ họa và phát hiện vị trí văn bản.
Nhiệm vụ: Tìm chính xác vị trí của đoạn chữ "${oldText}" trên ảnh và phân tích màu nền xung quanh để thay thế bằng nội dung mới "${newText || ''}".
Bạn PHẢI trả về duy nhất 1 chuỗi JSON hợp lệ (không bọc trong markdown \`\`\`json, không thêm text ngoài JSON):
{
  "found": true,
  "box_2d": [ymin, xmin, ymax, xmax],
  "old_text": "${oldText}",
  "new_text": "${newText || ''}",
  "font_size_ratio": 0.035,
  "font_family": "sans-serif",
  "font_weight": "bold",
  "font_color": "#111827",
  "bg_type": "solid",
  "bg_color_start": "#ffffff",
  "bg_color_end": "#ffffff",
  "text_align": "center"
}
Quy ước:
- box_2d: tọa độ chuẩn hóa từ 0 đến 1000 theo dạng [ymin, xmin, ymax, xmax].
- font_size_ratio: tỉ lệ chiều cao chữ xấp xỉ so với chiều cao ảnh (ví dụ 0.03 = 3% chiều cao ảnh).
- font_family: "sans-serif" (Arial/Roboto) hoặc "serif" (Times New Roman).
- font_weight: "bold" hoặc "normal".
- font_color: mã màu HEX của chữ (ví dụ #000000, #ff0000).
- bg_type: "solid" hoặc "gradient_horizontal" hoặc "gradient_vertical".
- bg_color_start và bg_color_end: mã màu HEX của nền xung quanh chữ.
- text_align: "center", "left", hoặc "right".
- Nếu hoàn toàn không thấy cụm từ đó trong ảnh: { "found": false, "message": "Không tìm thấy đoạn chữ trong ảnh" }.`;

            const contents = [{
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: mimeType || 'image/jpeg',
                            data: imageBase64
                        }
                    },
                    {
                        text: 'Phát hiện vị trí và màu sắc chữ "' + oldText + '" để thay thế.'
                    }
                ]
            }];

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1);
            let cleanedJson = text.trim();
            if (cleanedJson.startsWith('```json')) {
                cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            } else if (cleanedJson.startsWith('```')) {
                cleanedJson = cleanedJson.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            let patchData;
            try {
                patchData = JSON.parse(cleanedJson);
            } catch (err) {
                console.error('Không thể parse JSON từ Gemini:', text);
                throw new Error('Gemini phản hồi không phải JSON: ' + text.substring(0, 100));
            }

            const result = { status: 'success', patch: patchData, modelUsed };
            if (res.status) return res.status(200).json(result);
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // 3. ACTION: AI PROMPT EDIT (CHỈNH SỬA / LÀM ĐẸP / BỘ LỌC THEO MIÊU TẢ TEXT)
        if (action === 'ai_prompt_edit') {
            const userPrompt = promptText || 'Làm đẹp ảnh, nâng cao chất lượng và tối ưu màu sắc';
            const systemPrompt = `Bạn là chuyên gia đồ họa và color grading ảnh AI.
Người dùng yêu cầu: "${userPrompt}".
Hãy phân tích hình ảnh và yêu cầu trên, đưa ra nhận xét và các thông số điều chỉnh bộ lọc màu sắc, ánh sáng, tương phản phù hợp nhất.
Chỉ trả về duy nhất 1 chuỗi JSON (không bọc trong markdown \`\`\`json):
{
  "explanation": "Lời giải thích ngắn gọn bằng tiếng Việt về những gì AI đã cân chỉnh cho bức ảnh",
  "filters": {
    "brightness": 0,
    "contrast": 0,
    "blackPoint": 0,
    "whitePoint": 255,
    "saturation": 0,
    "sepia": 0,
    "warmth": 0,
    "sharpen": false,
    "grayscale": false,
    "invert": false
  }
}
Phạm vi giá trị:
- brightness: từ -100 đến 100
- contrast: từ -100 đến 100
- blackPoint: từ 0 đến 100
- whitePoint: từ 150 đến 255
- saturation: từ -100 đến 100
- sepia: từ 0 đến 100
- warmth: từ -100 đến 100
- sharpen, grayscale, invert: boolean true/false.`;

            const contents = [{
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: mimeType || 'image/jpeg',
                            data: imageBase64
                        }
                    },
                    {
                        text: userPrompt
                    }
                ]
            }];

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.2);
            let cleanedJson = text.trim();
            if (cleanedJson.startsWith('```json')) {
                cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            } else if (cleanedJson.startsWith('```')) {
                cleanedJson = cleanedJson.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            let editData;
            try {
                editData = JSON.parse(cleanedJson);
            } catch (e) {
                editData = { explanation: text, filters: {} };
            }

            const result = { status: 'success', aiEdit: editData, modelUsed };
            if (res.status) return res.status(200).json(result);
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // 4. ACTION: AI AUTO CROP & PERSPECTIVE DESKEW (TỰ ĐỘNG CROP VÀ CĂN CHỈNH GÓC)
        if (action === 'ai_auto_crop') {
            const systemPrompt = `Bạn là chuyên gia thị giác máy tính và xử lý scan tài liệu, căn chỉnh góc ảnh (document deskew, perspective alignment & auto-crop).
Nhiệm vụ: Phát hiện đối tượng chính (văn bản, trang giấy, tài liệu, bảng biểu, thiệp mời, chứng chỉ, thẻ, hoặc chủ thể chính) trong ảnh:
1. Xác định góc nghiêng (skew angle / tilt) theo độ (từ -45 đến 45 độ, số thực ví dụ 0.0, 1.5, hoặc -2.0 độ) cần xoay để chữ và cạnh tài liệu hoàn toàn thẳng đứng và ngang ngay ngắn 90 độ.
2. Xác định khung cắt [ymin, xmin, ymax, xmax] từ 0 đến 1000 ôm sát vùng tài liệu/chủ thể, loại bỏ các phần viền thừa (mặt bàn, bóng đổ, viền trống thừa ngoài rìa).
Chỉ trả về DUY NHẤT 1 JSON hợp lệ (không bọc trong markdown \`\`\`json, không thêm text ngoài JSON):
{
  "deskew_angle": 0.0,
  "crop_box": [ymin, xmin, ymax, xmax],
  "explanation": "Đã phát hiện tài liệu, căn chỉnh góc nghiêng và cắt sát viền đối tượng."
}`;

            const contents = [{
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: mimeType || 'image/jpeg',
                            data: imageBase64
                        }
                    },
                    {
                        text: 'Tự động xác định góc nghiêng cần xoay để ngay ngắn và tọa độ khung cắt sát viền tài liệu.'
                    }
                ]
            }];

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1);
            let cleanedJson = text.trim();
            if (cleanedJson.startsWith('```json')) {
                cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            } else if (cleanedJson.startsWith('```')) {
                cleanedJson = cleanedJson.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            let cropData;
            try {
                cropData = JSON.parse(cleanedJson);
            } catch (e) {
                cropData = { deskew_angle: 0.0, crop_box: [100, 100, 900, 900], explanation: text };
            }

            const result = { status: 'success', cropResult: cropData, modelUsed };
            if (res.status) return res.status(200).json(result);
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // 5. ACTION: AI AUTO ROTATE (TỰ ĐỘNG XOAY NGAY NGẮN HƯỚNG ẢNH VÀ CHỮ)
        if (action === 'ai_auto_rotate') {
            const systemPrompt = `Bạn là chuyên gia thị giác máy tính và phân tích hướng văn bản, xoay ảnh tài liệu ngay ngắn (image auto-rotation, deskew & text orientation detection).
Nhiệm vụ: Phân tích hướng của văn bản, chữ viết và đối tượng trong ảnh để tính toán góc cần xoay giúp ảnh thẳng đứng và văn bản đọc xuôi chiều tự nhiên từ trái sang phải, từ trên xuống dưới:
1. "orientation_correction": Góc xoay thô nếu ảnh bị chụp lộn ngược hoặc nằm ngang (chọn một trong các giá trị: 0, 90, 180, hoặc 270 độ theo chiều kim đồng hồ).
2. "fine_tilt_angle": Góc nghiêng nhỏ lẻ (số thực từ -45.0 đến 45.0 độ, ví dụ 2.5 hoặc -3.8 độ; số dương là xoay theo chiều kim đồng hồ, số âm là ngược chiều kim đồng hồ) để các dòng chữ hoàn toàn nằm ngang song song với cạnh đáy.
3. "total_rotate_angle": Tổng góc cần xoay để ảnh thẳng = orientation_correction + fine_tilt_angle.
4. "is_already_straight": true nếu ảnh đã thẳng hàng ngay ngắn sẵn (total_rotate_angle gần 0, sai số < 0.5 độ), ngược lại là false.
5. "explanation": Giải thích ngắn gọn bằng tiếng Việt (ví dụ: "Ảnh bị nghiêng 12 độ, đã tính toán góc xoay cân chỉnh." hoặc "Ảnh và chữ đã ngay ngắn sẵn.").
Chỉ trả về DUY NHẤT 1 JSON hợp lệ (không bọc trong markdown \`\`\`json, không thêm text ngoài JSON):
{
  "orientation_correction": 0,
  "fine_tilt_angle": 0.0,
  "total_rotate_angle": 0.0,
  "is_already_straight": true,
  "explanation": "Ảnh và chữ đã ngay ngắn chuẩn."
}`;

            const contents = [{
                role: 'user',
                parts: [
                    {
                        inline_data: {
                            mime_type: mimeType || 'image/jpeg',
                            data: imageBase64
                        }
                    },
                    {
                        text: 'Phân tích hướng chữ và góc nghiêng của ảnh để xác định góc cần xoay cho thẳng hàng ngay ngắn.'
                    }
                ]
            }];

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1);
            let cleanedJson = text.trim();
            if (cleanedJson.startsWith('```json')) {
                cleanedJson = cleanedJson.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
            } else if (cleanedJson.startsWith('```')) {
                cleanedJson = cleanedJson.replace(/^```\s*/i, '').replace(/\s*```$/, '');
            }

            let rotateData;
            try {
                rotateData = JSON.parse(cleanedJson);
            } catch (e) {
                rotateData = {
                    orientation_correction: 0,
                    fine_tilt_angle: 0.0,
                    total_rotate_angle: 0.0,
                    is_already_straight: true,
                    explanation: text
                };
            }

            const result = { status: 'success', rotateResult: rotateData, modelUsed };
            if (res.status) return res.status(200).json(result);
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        throw new Error('Hành động (action) không hợp lệ: ' + action);

    } catch (err) {
        console.error('Lỗi Studio API:', err);
        const errRes = { status: 'error', message: err.message };
        if (res.status) return res.status(500).json(errRes);
        res.writeHead(500, { 'Content-Type': 'application/json;charset=utf-8' });
        return res.end(JSON.stringify(errRes));
    }
};
