// Which AI gave an answer (ai.js): Claude or ChatGPT, and its model in a few words, e.g.
// claude-opus-5-5 → Opus 5.5, gpt-6.1-sol → GPT-6.1 Sol. Answers from before it was kept have none.
export const AI_NAMES = { claude: 'Claude', codex: 'ChatGPT' };
export function modelName(model = '') {
  const id = String(model).replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
  if (!id) return '';
  const capital = (w) => w[0].toUpperCase() + w.slice(1);
  if (id.startsWith('claude-')) {
    const parts = id.slice(7).split('-');
    const words = parts.filter((p) => !/^\d+$/.test(p)).map(capital);
    const numbers = parts.filter((p) => /^\d+$/.test(p));
    return [...words, numbers.join('.')].filter(Boolean).join(' ');
  }
  if (id.startsWith('gpt-')) {
    const [, version, ...rest] = id.split('-');
    return [`GPT-${version}`, ...rest.map(capital)].join(' ');
  }
  return id;
}
// Claude Opus 5.5; ChatGPT (GPT-6.1 Sol); just the name when the model is not known.
export function aiLabel(message) {
  const name = AI_NAMES[message.ai];
  if (!name) return '';
  const model = modelName(message.model);
  if (!model) return name;
  return message.ai === 'codex' ? `${name} (${model})` : `${name} ${model}`;
}
