// 知识图谱用的 LLM 调用：DeepSeek（OpenAI 兼容）+ JSON 模式 + 重试
import OpenAI from 'openai';
import config from '../config.js';

const client = new OpenAI({
  apiKey: config.deepseek.apiKey,
  baseURL: config.deepseek.baseURL,
  timeout: 180_000,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** PDF 文字层里的生僻字常留下半个代理对，原样发出去接口会拒收（400） */
export function wellFormed(text) {
  return String(text ?? '').replace(LONE_SURROGATE, '');
}

/** 去掉模型偶尔包裹的 ```json 围栏后解析 */
function parseJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  return JSON.parse(cleaned);
}

/**
 * 请求结构化 JSON。失败（网络 / 限流 / 输出不是合法 JSON）按指数退避重试。
 * 返回解析后的对象；多次失败抛最后一次的错误。
 */
export async function chatJson({ system, user, maxTokens = 8000, temperature = 0.2, retries = 4 }) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await client.chat.completions.create({
        model: config.deepseek.model,
        response_format: { type: 'json_object' },
        temperature,
        max_tokens: maxTokens,
        // V4 默认开启思考，推理 token 会挤占 JSON 输出，抽取任务不需要
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: wellFormed(system) },
          { role: 'user', content: wellFormed(user) },
        ],
      });
      const choice = resp.choices?.[0];
      if (choice?.finish_reason === 'length') {
        // 输出被截断重试也一样，交给调用方缩小输入
        const err = new Error('模型输出超出 max_tokens 被截断');
        err.code = 'LENGTH';
        throw err;
      }
      if (!choice?.message?.content) {
        throw new Error(`模型返回为空（finish_reason=${choice?.finish_reason}）`);
      }
      return parseJson(choice.message.content);
    } catch (e) {
      lastError = e;
      if (e.code === 'LENGTH') break;
      if (attempt < retries) await sleep(2000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

/**
 * 看图转写：deepseek-flash 是多模态模型，图片以 data URL 传入，返回纯文本。
 * 用于没有文字层的教材页面图。
 */
export async function chatVision({ prompt, image, mime = 'image/jpeg', maxTokens = 4000, retries = 4, model = config.deepseek.visionModel }) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${Buffer.from(image).toString('base64')}` } },
          ],
        }],
      });
      const choice = resp.choices?.[0];
      const text = choice?.message?.content;
      if (!text) throw new Error(`模型返回为空（finish_reason=${choice?.finish_reason}）`);
      return { text, truncated: choice.finish_reason === 'length' };
    } catch (e) {
      lastError = e;
      if (attempt < retries) await sleep(2000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}
