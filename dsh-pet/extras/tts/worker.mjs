// 运行时 TTS：stdin 读文本，合成到 argv[2] 指定的 mp3 文件，最后打印 OK。
// 由桌面 Helper 主进程 spawn（ELECTRON_RUN_AS_NODE=1），一次一句、串行调用。
// edge-tts 对并发和频率敏感，偶发 429 / 握手失败：带退避重试，别把一次抖动甩给上层。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) {
  console.error('missing output path');
  process.exit(2);
}

let text = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) text += chunk;
text = text.replace(/\s+/g, ' ').trim().slice(0, 300);
if (!text) {
  console.error('empty text');
  process.exit(3);
}

const cfg = JSON.parse(fs.readFileSync(path.join(here, 'voice-config.json'), 'utf8'));
fs.mkdirSync(path.dirname(out), { recursive: true });
const prosody = { rate: cfg.rate || '+0%', pitch: cfg.pitch || '+0Hz', volume: cfg.volume || '+0%' };

const ATTEMPTS = 3;
let lastErr;
for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(cfg.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioFilePath } = await tts.toFile(path.dirname(out), text, prosody);
    fs.renameSync(audioFilePath, out);
    console.log('OK');
    process.exit(0);
  } catch (e) {
    lastErr = e;
    if (attempt === ATTEMPTS - 1) break;
    // 429 / 限流退避长一点，其它抖动短一点
    const rateLimited = /429|too many|rate limit|throttl/i.test(String(e && e.message));
    await new Promise((r) => setTimeout(r, rateLimited ? 1800 * (attempt + 1) : 700));
  }
}
console.error('tts failed: ' + (lastErr && lastErr.message ? lastErr.message : lastErr));
process.exit(1);
