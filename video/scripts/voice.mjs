/**
 * Narration with Gemini TTS → public/voice/full.wav (one request for the whole film)
 *
 *   GEMINI_API_KEY=… npm run voice                  # whole narration → full.wav
 *   GEMINI_API_KEY=… npm run voice -- --force       # record it again
 *   GEMINI_API_KEY=… npm run voice -- --scene=meet  # re-record one scene → scenes/meet.wav
 *
 * The key is read from the environment only; never commit it.
 */
import { GoogleGenAI } from '@google/genai';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const narration = JSON.parse(readFileSync(join(root, 'narration.json'), 'utf8'));
const outDir = join(root, 'public', 'voice');
mkdirSync(outDir, { recursive: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('Set GEMINI_API_KEY in the environment.');
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

/** Spoken text: markup (`|` line breaks, `*emphasis*`) removed. */
export function spokenText(text) {
  return text.replace(/\|/g, ' ').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

function parseMime(mimeType) {
  // e.g. "audio/L16;codec=pcm;rate=24000"
  const [type, ...params] = mimeType.split(';').map((s) => s.trim());
  const format = type.split('/')[1] ?? '';
  const bits = format.startsWith('L') ? parseInt(format.slice(1), 10) : 16;
  let rate = 24000;
  for (const param of params) {
    const [key, value] = param.split('=').map((s) => s.trim());
    if (key === 'rate') rate = parseInt(value, 10);
  }
  return { channels: 1, rate, bits: Number.isNaN(bits) ? 16 : bits };
}

function wav(pcm, { channels, rate, bits }) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE((rate * channels * bits) / 8, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function synthesize(text) {
  const response = await ai.models.generateContentStream({
    model: narration.model,
    config: {
      temperature: 1,
      responseModalities: ['audio'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: narration.voice } } },
    },
    contents: [{ role: 'user', parts: [{ text: `${narration.direction}\n\n## Transcript:\n${text}` }] }],
  });
  const chunks = [];
  let mimeType = '';
  for await (const chunk of response) {
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (!part.inlineData?.data) continue;
      mimeType ||= part.inlineData.mimeType ?? '';
      chunks.push(Buffer.from(part.inlineData.data, 'base64'));
    }
  }
  if (!chunks.length) throw new Error('No audio in the response');
  const pcm = Buffer.concat(chunks);
  if (/wav/i.test(mimeType)) return pcm; // already a container
  return wav(pcm, parseMime(mimeType || 'audio/L16;rate=24000'));
}

/** Daily quotas don't reset in seconds: retrying only burns requests. */
function isDailyQuota(error) {
  return /PerDay/i.test(String(error?.message ?? error));
}

async function generate(file, text) {
  for (let attempt = 1; ; attempt++) {
    try {
      const audio = await synthesize(text);
      writeFileSync(file, audio);
      console.log(`${file.replace(root + '/', '')}: ${(audio.length / 1024).toFixed(0)} KB`);
      return;
    } catch (error) {
      if (attempt >= 3 || isDailyQuota(error)) throw error;
      const wait = 5000 * 2 ** attempt;
      console.warn(`${String(error?.message ?? error).slice(0, 160)}; retrying in ${wait / 1000}s`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

if (typeof args.scene === 'string') {
  // Re-record one scene on its own; it replaces that scene's part of full.wav.
  const scene = narration.scenes.find((s) => s.id === args.scene);
  if (!scene) throw new Error(`Unknown scene ${args.scene}`);
  mkdirSync(join(outDir, 'scenes'), { recursive: true });
  await generate(join(outDir, 'scenes', `${scene.id}.wav`), spokenText(scene.text));
} else {
  // The whole narration in one request: one consistent read, and one request against the quota.
  const file = join(outDir, 'full.wav');
  if (existsSync(file) && !args.force) {
    console.log('public/voice/full.wav exists (use --force to regenerate)');
  } else {
    await generate(file, narration.scenes.map((scene) => spokenText(scene.text)).join('\n\n'));
  }
}
