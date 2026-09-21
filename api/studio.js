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

function getCandidateModels(selectedModel) {
    if (selectedModel === 'gemini-3.1-pro-preview') {
        return ['gemini-3.1-pro-preview', 'gemini-3.5-flash', 'gemini-2.5-pro'];
    }
    if (selectedModel === 'gemini-2.5-pro') {
        return ['gemini-2.5-pro', 'gemini-3.5-flash', 'gemini-3.1-pro-preview'];
    }
    if (selectedModel === 'gemini-3.8-flash') {
        return ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-2.5-flash'];
    }
    if (selectedModel === 'gemini-3.7-flash') {
        return ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
    }
    if (selectedModel === 'gemini-3.6-flash') {
        return ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
    }
    if (selectedModel === 'gemini-3.5-flash' || selectedModel === 'flash_auto' || selectedModel === 'gemini-flash') {
        return ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
    }
    if (selectedModel === 'gemini-2.5-flash') {
        return ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash'];
    }
    if (selectedModel && selectedModel !== 'auto') {
        return [selectedModel, 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
    }
    // Mặc định auto: Luôn ưu tiên Gemini 3.5 Flash trước tiên, fallback sang 3.6, 3.7, 3.8 và Flash 2.5
    return ['gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-2.5-flash'];
}

async function callGemini(contents, systemInstruction, temperature = 0.2, selectedModel = null, customApiKey = null) {
    const apiKey = (customApiKey && customApiKey.trim()) ? customApiKey.trim() : resolveApiKey();
    let lastError = null;

    const candidateModels = getCandidateModels(selectedModel);

    for (const model of candidateModels) {
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
                const parts = data.candidates?.[0]?.content?.parts || [];
                let text = '';
                for (const p of parts) {
                    if (p.text && !p.thought) {
                        text += p.text;
                    }
                }
                if (!text && parts[0]?.text) {
                    text = parts[0].text;
                }
                if (text) {
                    return { text, modelUsed: model };
                }
            } else {
                const errData = await response.json().catch(() => ({}));
                const msg = errData.error?.message || ('HTTP ' + response.status);
                console.warn('Gemini model ' + model + ' returned error: ' + msg);

                if (selectedModel && selectedModel.includes('pro') && (msg.includes('limit: 0') || msg.includes('Quota exceeded'))) {
                    lastError = new Error(`Model "${model}" yêu cầu tài khoản Google AI Studio có kích hoạt Billing (hạn mức miễn phí hiện tại là 0). Bạn vui lòng chọn model "Gemini 3.5/2.5 Flash" để dùng miễn phí, hoặc nhập API Key có Billing.`);
                } else {
                    lastError = new Error(model + ': ' + msg);
                }
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

    const { action, imageBase64, mimeType, oldText, newText, promptText, selectedModel, customApiKey } = body || {};

    try {
        // 0. HEALTH CHECK & PING ACTION
        if (action === 'ping' || action === 'health') {
            const result = { status: 'success', message: 'Studio API v3.0 is healthy', version: '3.0' };
            if (res.status) return res.status(200).json(result);
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        if (!imageBase64 && !body.pdfBase64) {
            throw new Error('Chưa cung cấp dữ liệu hình ảnh hoặc file PDF.');
        }

        // 1. ACTION: OCR TRÍCH XUẤT VĂN BẢN VÀ CHUYỂN ĐỔI SANG WORD (.DOCX)
        if (action === 'ocr_docx') {
            const systemPrompt = `Bạn là chuyên gia trích xuất tài liệu văn bản, biểu mẫu hành chính, hợp đồng, chứng chỉ sang Word (.docx) chuẩn trang giấy A4.
Nhiệm vụ: Nhận diện chính xác 100% nội dung chữ, dấu tiếng Việt, bố cục đoạn văn, tiêu đề và cấu trúc bảng biểu của tài liệu để chuyển thành mã HTML cấu trúc sạch (semantic HTML).
Quy tắc định dạng bắt buộc:
1. BỐ CỤC CHUẨN A4:
   - Quốc hiệu, tiêu ngữ, tiêu đề tài liệu ở đầu trang: dùng <p style="text-align: center;"><b>...</b></p> hoặc <h1>, <h2>.
   - Tiêu đề phụ, đề mục dùng <h3>, <h4>.
   - Đoạn văn chuẩn dùng thẻ <p>. Nếu văn bản được căn đều hoặc căn giữa trong ảnh, thêm thuộc tính style tương ứng (ví dụ: style="text-align: center;" hoặc style="text-align: right;").
   - Giữ nguyên định dạng chữ in đậm <b>, in nghiêng <i>, gạch chân <u>.
2. BẢNG BIỂU (TABLES) — ĐẶC BIỆT QUAN TRỌNG:
   - Nếu tài liệu có bảng biểu, bạn PHẢI tạo đúng cấu trúc chuẩn:
     <table>
       <thead>
         <tr>
           <th style="text-align: center;">STT</th>
           <th style="text-align: center;">Họ và tên</th>
           <th style="text-align: center;">Chức vụ</th>
         </tr>
       </thead>
       <tbody>
         <tr>
           <td style="text-align: center;">1</td>
           <td>Nguyễn Văn A</td>
           <td>Trưởng phòng</td>
         </tr>
       </tbody>
     </table>
   - Đảm bảo đầy đủ số hàng, số cột. Nếu có gộp ô, bắt buộc dùng thuộc tính colspan="..." hoặc rowspan="...".
   - Bắt buộc dùng <th> cho hàng tiêu đề cột của bảng để được áp dụng định dạng Header chuyên nghiệp trong Word.
   - Căn lề từng cột trong bảng: Số/STT căn giữa, Tên/Nội dung căn trái, Số tiền/Ngày tháng/Tỷ lệ căn phải hoặc giữa.
   - Nếu trong một ô có nhiều dòng hoặc nội dung xuống dòng, hãy dùng thẻ <br> để ngắt dòng chuẩn xác.
3. DANH SÁCH & KÝ HIỆU:
   - Dùng <ul><li> hoặc <ol><li> cho các mục liệt kê.
4. CHÍNH TẢ & DẤU TIẾNG VIỆT:
   - Giữ chính xác 100% từng ký tự, dấu tiếng Việt (kể cả dấu hỏi, ngã, nặng), chữ số và ký hiệu đặc biệt.
5. ĐẦU RA:
   - QUAN TRỌNG: Chỉ trả về mã HTML sạch thuần túy. Tuyệt đối KHÔNG bọc trong khối markdown \`\`\`html và không kèm bất kỳ câu chữ giải thích nào.`;

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
                        text: 'Hãy trích xuất toàn bộ tài liệu này thành mã HTML sạch để đưa vào tài liệu Word (.docx) chuẩn khổ A4 và bảo toàn bảng biểu.'
                    }
                ]
            }];

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1, selectedModel, customApiKey);
            let cleanedHtml = (text || '').trim();
            const htmlMatch = cleanedHtml.match(/```(?:html)?\s*([\s\S]*?)\s*```/i);
            if (htmlMatch) {
                cleanedHtml = htmlMatch[1].trim();
            } else {
                cleanedHtml = cleanedHtml.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
            }

            const result = { status: 'success', html: cleanedHtml, modelUsed };
            if (res.status) return res.status(200).json(result);
            res.writeHead(200, { 'Content-Type': 'application/json;charset=utf-8' });
            return res.end(JSON.stringify(result));
        }

        // 2. ACTION: AI EDIT TEXT (THAY THẾ CHỮ TRÊN ẢNH GIỮ NỀN VÀ MÀU GỐC)
        if (action === 'ai_edit_text') {
            if (!oldText) throw new Error('Vui lòng nhập chữ/thông tin cần thay thế (oldText).');

            const regionBoxInfo = body.regionBox 
                ? `\nCHÚ Ý QUAN TRỌNG: Người dùng đã khoanh vùng chọn chứa đoạn chữ cần sửa tại tọa độ chuẩn hóa box_2d: [${body.regionBox.join(', ')}]. Bạn CHỈ ĐƯỢC PHÉP tìm và thay thế đoạn chữ "${oldText}" nằm BÊN TRONG hoặc giao cắt với vùng chọn này, bỏ qua các đoạn chữ giống hệt nằm ở vị trí khác trên ảnh.` 
                : '';

            const systemPrompt = `Bạn là chuyên gia phân tích thị giác đồ họa, typography và màu sắc ảnh.
Nhiệm vụ: Tìm chính xác vị trí của đoạn chữ "${oldText}" trên ảnh và phân tích chi tiết màu chữ, màu nền xung quanh để thay thế bằng nội dung mới "${newText || ''}".${regionBoxInfo}
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
Quy ước độ chính xác:
- box_2d: tọa độ chuẩn hóa từ 0 đến 1000 theo dạng [ymin, xmin, ymax, xmax]. Khoanh VỪA KHÍT bao quanh đoạn chữ "${oldText}", không khoanh quá rộng làm lem nền xung quanh.
- font_size_ratio: tỉ lệ chiều cao chữ xấp xỉ so với chiều cao ảnh (ví dụ 0.03 = 3% chiều cao ảnh).
- font_family: "sans-serif" (Arial, Roboto, Helvetica) hoặc "serif" (Times New Roman, Georgia).
- font_weight: "bold" hoặc "normal".
- font_color: mã màu HEX chuẩn xác của nét chữ gốc trong ảnh (ví dụ #0f172a, #1e293b, #b91c1c, #047857).
- bg_type: "solid" (nền màu đơn sắc), "gradient_horizontal" (nền chuyển màu ngang) hoặc "gradient_vertical" (nền chuyển màu dọc).
- bg_color_start và bg_color_end: mã màu HEX thực tế của nền giấy/ảnh xung quanh ngay sát viền chữ (chú ý độ ngả vàng của giấy cũ hoặc màu sắc nền trang trí).
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
                        text: 'Phát hiện vị trí và màu sắc chữ "' + oldText + '" để thay thế.' + (body.regionBox ? ' Hãy chú ý vùng chọn box_2d đã được chỉ định.' : '')
                    }
                ]
            }];

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1, selectedModel, customApiKey);
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
            const systemPrompt = `Bạn là chuyên gia đồ họa, chỉnh sửa ảnh và AI.
Người dùng yêu cầu: "${userPrompt}".
Dựa vào yêu cầu và hình ảnh, hãy phân tích và quyết định danh sách các hành động cần thực hiện.
Các hành động có thể bao gồm:
1. "filters": Điều chỉnh độ sáng, tương phản, màu sắc. (Hành động này luôn nên có nếu người dùng miêu tả việc làm đẹp ảnh).
2. "crop": Cắt ảnh tự động theo yêu cầu (ví dụ: cắt sát viền, cắt bỏ nền thừa). Trả về tọa độ "box_2d": [ymin, xmin, ymax, xmax] chuẩn hóa 0-1000.
3. "replace_text": Thay thế chữ. Trả về "old_text", "new_text" và "box_2d" của vị trí chữ cũ (chuẩn hóa 0-1000). Cần phân tích chi tiết "font_size_ratio", "font_family", "font_weight", "font_color", "bg_type", "bg_color_start", "bg_color_end", "text_align" giống như AI Edit Text.

Chỉ trả về duy nhất 1 chuỗi JSON (không bọc trong markdown \`\`\`json):
{
  "explanation": "Lời giải thích ngắn gọn bằng tiếng Việt về những gì AI đã làm",
  "actions": [
    {
      "action": "filters",
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
    },
    {
      "action": "crop",
      "box_2d": [100, 100, 900, 900]
    },
    {
      "action": "replace_text",
      "old_text": "chữ cũ",
      "new_text": "chữ mới",
      "box_2d": [ymin, xmin, ymax, xmax],
      "font_size_ratio": 0.035,
      "font_family": "sans-serif",
      "font_weight": "bold",
      "font_color": "#111827",
      "bg_type": "solid",
      "bg_color_start": "#ffffff",
      "bg_color_end": "#ffffff",
      "text_align": "center"
    }
  ]
}
Chỉ bao gồm các action cần thiết theo yêu cầu. Phạm vi giá trị filters: brightness/contrast/saturation/warmth (-100 đến 100), blackPoint (0-100), whitePoint (150-255), sepia (0-100).`;

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

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.2, selectedModel, customApiKey);
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

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1, selectedModel, customApiKey);
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

            const { text, modelUsed } = await callGemini(contents, systemPrompt, 0.1, selectedModel, customApiKey);
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
