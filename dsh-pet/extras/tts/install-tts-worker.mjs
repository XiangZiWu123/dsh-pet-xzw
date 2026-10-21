#!/usr/bin/env node
/**
 * install-tts-worker.mjs —— 把包内的 TTS worker 装到用户数据目录。
 *
 * 为什么需要这一步：运行时语音合成读的是 ~/.dsh/dsh-pet/tts/worker.mjs（用户数据，不随包发布），
 * 而 edge-tts 会偶发 429 限流。带重试的版本在这里维护，装一次覆盖用户目录那份。
 *
 * 用法：node extras/tts/install-tts-worker.mjs
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'worker.mjs');
const destDir = join(homedir(), '.dsh', 'dsh-pet', 'tts');
const dest = join(destDir, 'worker.mjs');

if (!existsSync(join(destDir, 'voice-config.json'))) {
  console.error('[tts] 没找到 ' + destDir + '\\voice-config.json；先跑过一次桌宠语音生成（gen.mjs）再来。');
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log('[tts] 已安装 ' + dest);