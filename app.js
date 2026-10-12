"use strict";
/* Escuta: transcrição e resumos das gravações, tudo guardado neste aparelho.
   Transcrição: ElevenLabs Scribe v2. Correções, resumos e perguntas: Claude.
   As chaves das APIs ficam só no armazenamento local deste aparelho. */

/* ---------- utilitários ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = s => { s = Math.max(0, Math.round(s || 0)); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60;
  return h ? h+":"+String(m).padStart(2,"0")+":"+String(x).padStart(2,"0") : String(m).padStart(2,"0")+":"+String(x).padStart(2,"0"); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (s, g) => new RegExp(`(?<![\\p{L}\\p{N}])${reEsc(s)}(?![\\p{L}\\p{N}])`, "iu" + (g ? "g" : ""));
const usd = v => "US$ " + (v || 0).toFixed(2).replace(".", ",");
const monthKey = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2, "0");
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const dateLabel = ms => cap(new Date(ms).toLocaleDateString("pt-BR", {weekday:"long", day:"numeric", month:"long"}));
const dmy = ms => new Date(ms).toLocaleDateString("pt-BR");
const hm = ms => new Date(ms).toLocaleTimeString("pt-BR", {hour:"2-digit", minute:"2-digit"});

/* ---------- banco local (IndexedDB) ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((ok, bad) => {
      const r = indexedDB.open("escuta", 1);
      r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("files", {keyPath: "id"}); d.createObjectStore("audio"); d.createObjectStore("kv"); };
      r.onsuccess = () => { DB.db = r.result; ok(); };
      r.onerror = () => bad(r.error);
    });
  },
  tx(store, mode, fn) {
    return new Promise((ok, bad) => {
      const t = DB.db.transaction(store, mode), s = t.objectStore(store); let out;
      const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => ok(out); t.onerror = () => bad(t.error); t.onabort = () => bad(t.error);
    });
  },
  get: (st, k) => DB.tx(st, "readonly", s => s.get(k)),
  put: (st, v, k) => DB.tx(st, "readwrite", s => k === undefined ? s.put(v) : s.put(v, k)),
  del: (st, k) => DB.tx(st, "readwrite", s => s.delete(k)),
  all: st => DB.tx(st, "readonly", s => s.getAll()),
};

/* ---------- padrões ---------- */
const DEFAULT_VOCAB = {
  pessoas: [
    {w:"Tadashi", role:"Chef", was:["Tadá","Tadachi"]},
    {w:"Lucas Ryu", role:"Cozinha", was:["Lucas rio","Lucas Riu"]},
    {w:"Patrícia", role:"Gestão", was:[]},
    {w:"Larissa", role:"Cozinha, apelido Lari", was:[]},
    {w:"Pimentel", role:"Compras e recebimento", was:[]},
    {w:"Iago", role:"Cozinha", was:["Yago"]},
  ],
  ja: [
    {w:"shari", k:"シャリ", mean:"arroz temperado do sushi", was:["chari","xari"]},
    {w:"nori", k:"海苔", mean:"alga", was:[]},
    {w:"unagi", k:"鰻", mean:"enguia", was:["unagui"]},
    {w:"sushi-zu", k:"寿司酢", mean:"vinagre do sushi", was:["sushizu"]},
    {w:"itamae", k:"板前", mean:"sushiman", was:["itamai"]},
    {w:"omakase", k:"お任せ", mean:"menu do chef", was:["omacase"]},
  ],
  en: [
    {w:"prep", mean:"pré-preparo", was:["PrEP","prepi"]},
    {w:"take-out", mean:"para viagem", was:["teicaute","take out"]},
    {w:"delivery", mean:"entrega", was:["delivéri"]},
    {w:"mise en place", mean:"francês, organização da praça", was:["mizan plas"]},
  ],
  lugares: [
    {w:"Frescato", mean:"fornecedor", was:[]},
    {w:"Casa Bueno", mean:"fornecedor que entrega", was:["Casa Bom"]},
    {w:"Liberdade", mean:"bairro, compras", was:[]},
  ],
};
const TEMPLATES = [
  {name:"Relatório diário", guide:"Relatório falado do fim do dia. Seções, só as que tiverem conteúdo: Resumo do dia, Compras e fornecedores, Ocorrências, Equipe (desempenho e comportamento de cada pessoa citada), Decisões, Próximos passos. Itens curtos e diretos."},
  {name:"Ata de reunião", guide:"Ata formal. Seções: Participantes (quem falou ou foi citado como presente), Assuntos tratados (um item por assunto, com o que foi dito), Decisões, Tarefas (formato: Responsável: o quê, até quando, se dito), Pendências e dúvidas."},
  {name:"Aula / treinamento", guide:"Material de estudo para quem não assistiu. Seções: Objetivo, Ficha técnica (ingredientes, medidas, proporções e temperaturas exatamente como ditas), Passo a passo (numerado, na ordem ensinada), Pontos críticos, Erros comuns, Perguntas de revisão (3 a 5 perguntas para testar quem aprendeu)."},
  {name:"Conversa com fornecedor", guide:"Seções: Fornecedor e contato, Produtos e preços (valores exatamente como ditos), Condições (entrega, prazo, pagamento, pedido mínimo), Problemas e reclamações, Combinados e próximos passos."},
  {name:"Conversa 1:1", guide:"Conversa individual de gestão. Seções: Contexto, Pontos fortes, Pontos a melhorar, O que a pessoa disse (preocupações, pedidos), Combinados, Acompanhamento (o que verificar e quando)."},
  {name:"Resumo livre", guide:"Escolha as seções que melhor organizam o conteúdo (3 a 6). Comece com uma seção curta de visão geral e termine com decisões e próximos passos, se houver."},
];
const DEFAULT_FOLDERS = [
  {name:"Reuniões de equipe", desc:"Reuniões com a equipe do restaurante.", tpl:"Ata de reunião"},
  {name:"Relatórios diários", desc:"Relatório falado do fim do dia sobre a operação.", tpl:"Relatório diário"},
  {name:"Treinamentos", desc:"Aulas práticas de cozinha para a equipe.", tpl:"Aula / treinamento"},
  {name:"Fornecedores", desc:"Conversas e visitas a fornecedores.", tpl:"Conversa com fornecedor"},
];
const DEFAULT_CFG = {
  elKey: "", anKey: "", model: "claude-opus-5-5", lang: "pt", speakers: true, autogen: false, fallbacks: true,
  context: "Sou o Jose, gestor de um restaurante de sushi em São Paulo. As gravações são da operação: equipe, cozinha, compras e fornecedores.",
};
const MODELS = {
  "claude-opus-5-5": {label:"Claude Opus 5.5", hint:"melhor qualidade", inP:4, outP:20, perHour:0.45},
  "claude-sonnet-5-5": {label:"Claude Sonnet 5.5", hint:"mais barato", inP:2, outP:10, perHour:0.22},
};
const STT_PER_HOUR = 0.22;      // ElevenLabs Scribe v2, por hora de áudio (estimativa)
const KEYTERM_SURCHARGE = 1.2;  // +20% quando o vocabulário vai junto
const KINDS = {pessoas:"Pessoa", ja:"Termo em japonês", en:"Termo em inglês ou outro idioma", lugares:"Lugar ou empresa"};
const COLORS = ["#4b3fd6","#b3261e","#0a7d6c","#a15c00","#2f6fd6","#8a3ab9","#3a7d22","#c2410c"];

/* ---------- estado ---------- */
let files = [], CFG = {...DEFAULT_CFG}, VOCAB = {}, FOLDERS = [], CUSTOM_TPLS = [], USAGE = {}, SUGG = [], GQA = [];
const RUN = {};  // gerações em andamento, só na memória
let S = {tab:"files", open:null, seg:"sum", q:"", folder:"all", filter:"Todos", vfilter:"tudo", sel:null, edit:false};

const kv = (k, v) => DB.put("kv", v, k);
const saveCfg = () => kv("cfg", CFG);
const saveVocab = () => kv("vocab", VOCAB);
const saveFolders = () => kv("folders", FOLDERS);
const saveFile = f => DB.put("files", strip(f));
const strip = f => { const c = {...f}; delete c._plain; return c; };
const allTemplates = () => [...TEMPLATES, ...CUSTOM_TPLS];
const tplOf = name => allTemplates().find(t => t.name === name) || TEMPLATES[5];
const folderOf = name => FOLDERS.find(x => x.name === name);
const vcount = () => Object.values(VOCAB).reduce((a, l) => a + l.length, 0);
const fileById = id => files.find(x => x.id === id);

async function load() {
  await DB.open();
  CFG = {...DEFAULT_CFG, ...(await DB.get("kv", "cfg") || {})};
  VOCAB = await DB.get("kv", "vocab") || structuredClone(DEFAULT_VOCAB);
  for (const k of Object.keys(DEFAULT_VOCAB)) VOCAB[k] ||= [];
  Object.values(VOCAB).flat().forEach(i => { i.was ||= []; i.n ||= 0; });
  FOLDERS = await DB.get("kv", "folders") || structuredClone(DEFAULT_FOLDERS);
  CUSTOM_TPLS = await DB.get("kv", "tpls") || [];
  USAGE = await DB.get("kv", "usage") || {};
  SUGG = await DB.get("kv", "sugg") || [];
  GQA = await DB.get("kv", "gqa") || [];
  files = (await DB.all("files")).sort((a, b) => b.created - a.created);
  for (const f of files) if (f.status === "run") { f.status = "err"; f.err = "A geração foi interrompida porque o app foi fechado. Toque em Tentar de novo."; await saveFile(f); }
}

/* ---------- uso e custo ---------- */
async function addUsage(part) {
  const m = USAGE[monthKey()] ||= {sttSec:0, sttUsd:0, claudeUsd:0};
  for (const k in part) m[k] = (m[k] || 0) + part[k];
  await kv("usage", USAGE);
}
function estimate(f) {
  const h = (f.dur || 600) / 3600, stt = f.tr ? 0 : h * STT_PER_HOUR * (vcount() ? KEYTERM_SURCHARGE : 1);
  const cl = Math.max(0.02, h * (MODELS[CFG.model]?.perHour || 0.45));
  return {stt, cl, total: stt + cl};
}

/* ---------- Claude (chamada direta do navegador, com a chave do usuário) ---------- */
async function claude({system, content, schema, effort = "high", max = 16000}) {
  let useFb = CFG.fallbacks !== false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const body = {model: CFG.model, max_tokens: max, stream: true, system, thinking: {type: "adaptive"},
      output_config: {effort}, messages: [{role: "user", content}]};
    if (schema) body.output_config.format = {type: "json_schema", schema};
    const headers = {"content-type": "application/json", "x-api-key": CFG.anKey, "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"};
    if (useFb) { body.fallbacks = "default"; headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; }
    let r;
    try { r = await fetch("https://api.anthropic.com/v1/messages", {method: "POST", headers, body: JSON.stringify(body)}); }
    catch (e) { if (attempt < 3) { await sleep(2000 * (attempt + 1)); continue; } throw new Error("Sem conexão com o Claude. Verifique a internet."); }
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 400 && useFb && /fallback|beta/i.test(t)) { useFb = false; attempt--; continue; }
      if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 3) { await sleep(4000 * (attempt + 1)); continue; }
      throw new Error(apiError("Claude", r.status, t));
    }
    const out = await readStream(r);
    const price = MODELS[CFG.model] || MODELS["claude-opus-5-5"];
    await addUsage({claudeUsd: (out.inTok * price.inP + out.outTok * price.outP) / 1e6});
    if (out.stop === "refusal") throw new Error("O Claude recusou este conteúdo.");
    if (out.stop === "max_tokens") throw new Error("A resposta ficou longa demais. Tente de novo ou use um modelo de resumo mais curto.");
    if (!schema) return out.text;
    try { return JSON.parse(out.text); } catch { throw new Error("O Claude devolveu uma resposta incompleta. Tente de novo."); }
  }
}
async function readStream(r) {
  const rd = r.body.getReader(), dec = new TextDecoder();
  let buf = "", text = "", inTok = 0, outTok = 0, stop = null, blockType = {};
  const handle = ev => {
    if (ev.type === "message_start") { const u = ev.message?.usage || {}; inTok += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) * 0.1; }
    else if (ev.type === "content_block_start") { blockType[ev.index] = ev.content_block?.type; if (ev.content_block?.type === "fallback") text = ""; }
    else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
    else if (ev.type === "message_delta") { stop = ev.delta?.stop_reason || stop; outTok = ev.usage?.output_tokens || outTok; }
    else if (ev.type === "error") throw new Error("Claude: " + (ev.error?.message || "erro no meio da resposta"));
  };
  for (;;) {
    const {value, done} = await rd.read();
    if (done) break;
    buf += dec.decode(value, {stream: true});
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
      if (data) handle(JSON.parse(data));
    }
  }
  return {text, inTok, outTok, stop};
}
function apiError(who, status, body) {
  let msg = body;
  try { const j = JSON.parse(body); msg = j.error?.message || j.detail?.message || (typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail || j)); } catch {}
  if (status === 401) return `${who}: a chave da API não foi aceita. Confira em Eu › Chaves.`;
  if (status === 402 || /credit|quota|balance/i.test(msg)) return `${who}: sem créditos na conta. ${msg}`;
  return `${who} (${status}): ${String(msg).slice(0, 300)}`;
}

/* ---------- ElevenLabs Scribe ---------- */
function keyterms() {
  const out = new Set();
  for (const it of Object.values(VOCAB).flat()) {
    const w = (it.w || "").trim();
    if (w && w.length < 50 && w.split(/\s+/).length <= 5 && !/[<>{}[\]\\]/.test(w)) out.add(w);
  }
  return [...out].slice(0, 1000);
}
async function transcribeEL(f) {
  const blob = await DB.get("audio", f.id);
  if (!blob) throw new Error("O áudio deste arquivo não está neste aparelho.");
  const fd = new FormData();
  fd.append("model_id", "scribe_v2");
  fd.append("file", blob, f.fname || "audio");
  if (CFG.lang !== "auto") fd.append("language_code", CFG.lang);
  fd.append("diarize", String(!!CFG.speakers));
  fd.append("timestamps_granularity", "word");
  fd.append("tag_audio_events", "false");
  const kt = keyterms(); kt.forEach(k => fd.append("keyterms", k));
  let r;
  try { r = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {method: "POST", headers: {"xi-api-key": CFG.elKey}, body: fd}); }
  catch { throw new Error("Não consegui falar com o ElevenLabs. Verifique a internet e tente de novo."); }
  if (!r.ok) throw new Error(apiError("ElevenLabs", r.status, await r.text()));
  const j = await r.json();
  const words = j.words || [];
  const end = words.reduce((a, w) => Math.max(a, w.end || 0), 0) || f.dur || 0;
  await addUsage({sttSec: end, sttUsd: end / 3600 * STT_PER_HOUR * (kt.length ? KEYTERM_SURCHARGE : 1)});
  return {words, text: j.text || "", lang: j.language_code, end};
}
function buildSegs(words, text) {
  const segs = []; let cur = null;
  for (const w of words) {
    if (w.type === "audio_event") continue;
    if (w.type === "spacing") { if (cur) cur.raw += w.text; continue; }
    const sp = w.speaker_id || "speaker_0", st = w.start ?? (cur ? cur.e : 0);
    const endSentence = cur && /[.?!…]["”]?\s*$/.test(cur.raw);
    if (!cur || sp !== cur.sp || st - cur.e > 1.6 || (st - cur.t > 25 && endSentence) || st - cur.t > 75) {
      cur = {t: st, e: w.end ?? st, sp, raw: ""}; segs.push(cur);
    }
    cur.raw += w.text; cur.e = w.end ?? cur.e;
  }
  if (!segs.length && text) segs.push({t: 0, e: 0, sp: "speaker_0", raw: text});
  for (const s of segs) { s.raw = clean(s.raw); s.text = s.raw; }
  return segs.filter(s => s.raw);
}
const clean = s => s.replace(/\s+/g, " ").trim().replace(/[{}|]/g, m => m === "|" ? "/" : m === "{" ? "(" : ")");

/* ---------- marcações na transcrição: {fix:certo|ouvido} {en:termo|ouvido} {ja:termo|kana} {?:palavra} ---------- */
const MK = /\{(fix|en|ja|\?):([^}]*)\}/g;
const plain = t => t.replace(MK, (m, k, v) => v.split("|")[0]);
function mapPlain(t, fn) {
  let out = "", last = 0;
  for (const m of t.matchAll(MK)) { out += fn(t.slice(last, m.index)) + m[0]; last = m.index + m[0].length; }
  return out + fn(t.slice(last));
}
function replaceOnce(seg, heard, repl) {
  let done = false; const re = wordRe(heard);
  seg.text = mapPlain(seg.text, p => done ? p : p.replace(re, m => { done = true; return repl(m); }));
  return done;
}
function highlightForeign(seg) {
  for (const kind of ["en", "ja"]) for (const it of VOCAB[kind]) {
    if (!it.w) continue;
    seg.text = mapPlain(seg.text, p => p.replace(wordRe(it.w, true), m => `{${kind}:${it.w}|${kind === "ja" ? clean(it.k || "") : clean(m)}}`));
  }
}
function marked(t) {
  return esc(t)
    .replace(/\{fix:([^|}]*)\|([^}]*)\}/g, (m, a, b) => `<span class="w-fix" title="Corrigido pelo vocabulário. Saiu como “${b}”">${a}</span>`)
    .replace(/\{en:([^|}]*)\|([^}]*)\}/g, (m, a, b) => `<span class="w-en" title="${a.toLowerCase() === b.toLowerCase() ? "Termo estrangeiro do vocabulário" : `Termo estrangeiro, saiu como “${b}”`}">${a}<sup>EN</sup></span>`)
    .replace(/\{ja:([^|}]*)\|([^}]*)\}/g, (m, a, b) => `<span class="w-ja" title="Japonês${b ? ": " + b : ""}">${a}<sup>JA</sup></span>`)
    .replace(/\{\?:([^}]*)\}/g, (m, a) => `<span class="w-q" title="Não reconhecido. Toque para adicionar ao vocabulário">${a}</span>`);
}
function italicTerms(html) {
  for (const it of [...VOCAB.en, ...VOCAB.ja]) if (it.w) html = html.replace(wordRe(esc(it.w), true), m => `<i>${m}</i>`);
  return html;
}

/* ---------- textos para o Claude ---------- */
function vocabText() {
  const line = (it, extra) => `- ${it.w}${extra ? ` (${extra})` : ""}${it.was.length ? `. Costuma sair errado como: ${it.was.join(", ")}` : ""}`;
  return [
    "PESSOAS:\n" + (VOCAB.pessoas.map(i => line(i, i.role)).join("\n") || "(nenhuma)"),
    "TERMOS EM JAPONÊS (escrever em romaji, como abaixo):\n" + (VOCAB.ja.map(i => line(i, [i.k, i.mean].filter(Boolean).join(", "))).join("\n") || "(nenhum)"),
    "TERMOS EM INGLÊS E OUTROS IDIOMAS (manter no original):\n" + (VOCAB.en.map(i => line(i, i.mean)).join("\n") || "(nenhum)"),
    "LUGARES E EMPRESAS:\n" + (VOCAB.lugares.map(i => line(i, i.mean)).join("\n") || "(nenhum)"),
  ].join("\n\n");
}
const spName = (f, sp) => f.tr?.speakers?.[sp] || "Pessoa " + (parseInt(String(sp).replace(/\D/g, "") || "0") + 1);
const trText = (f, useRaw) => f.tr.segs.map((s, i) => `#${i} [${fmt(s.t)}] ${spName(f, s.sp)}: ${useRaw ? s.raw : plain(s.text)}`).join("\n");
const ctxText = f => {
  const fo = folderOf(f.folder);
  return `CONTEXTO DO USUÁRIO:\n${CFG.context || "(não informado)"}\n\nGRAVAÇÃO: ${f.title} (${dmy(f.created)} ${hm(f.created)}, ${fmt(f.dur)})` +
    (fo ? `\nPASTA: ${fo.name}${fo.desc ? ". " + fo.desc : ""}` : "");
};
const SYS = "Você trabalha dentro do Escuta, um app que transforma gravações de áudio em transcrições e resumos confiáveis para um gestor brasileiro. A transcrição vem de reconhecimento de voz e pode ter erros. Responda sempre em português do Brasil. Nunca invente fatos, nomes, números ou decisões que não estejam no áudio.";

/* ---------- etapa 1: correções presas ao vocabulário ---------- */
const FIX_SCHEMA = {type:"object", additionalProperties:false, required:["corrections","unknown","speakers"], properties:{
  corrections:{type:"array", items:{type:"object", additionalProperties:false, required:["seg","heard","write"], properties:{seg:{type:"integer"}, heard:{type:"string"}, write:{type:"string"}}}},
  unknown:{type:"array", items:{type:"object", additionalProperties:false, required:["seg","heard"], properties:{seg:{type:"integer"}, heard:{type:"string"}}}},
  speakers:{type:"array", items:{type:"object", additionalProperties:false, required:["id","name"], properties:{id:{type:"string"}, name:{type:"string"}}}},
}};
async function fixPass(f) {
  const segs = f.tr.segs;
  segs.forEach(s => { s.text = s.raw; });
  const spIds = [...new Set(segs.map(s => s.sp))];
  const res = await claude({system: SYS, effort: "medium", max: 32000, schema: FIX_SCHEMA, content:
`${ctxText(f)}

VOCABULÁRIO (grafias corretas):
${vocabText()}

TRANSCRIÇÃO (cada linha: #número [tempo] falante: texto):
${trText(f, true)}

Tarefa: revise a transcrição acima procurando só erros de reconhecimento de voz que deveriam ser termos do VOCABULÁRIO.
1. corrections: cada trecho que claramente é um termo do vocabulário mal reconhecido (por exemplo "Tadá" no lugar de "Tadashi", "teicaute" no lugar de "take-out"). "seg" é o número da linha. "heard" é o trecho exatamente como aparece na linha (1 a 5 palavras, mesmas letras e acentos). "write" é copiado exatamente do vocabulário. Não corrija gramática, pontuação nem palavras que não sejam do vocabulário. Na dúvida, não corrija.
2. unknown: até 15 palavras que parecem nomes de pessoas, lugares, empresas ou termos estrangeiros mal reconhecidos e que não estão no vocabulário ("heard" exatamente como aparece).
3. speakers: falantes cujo nome fica claro pelo próprio áudio (alguém chama a pessoa pelo nome e ela responde, ou ela se apresenta). Ids possíveis: ${spIds.join(", ")}. Deixe vazio se não tiver certeza.`});
  const byLower = new Map();
  for (const [kind, list] of Object.entries(VOCAB)) for (const it of list) byLower.set(it.w.toLowerCase(), {kind, it});
  let changed = false;
  for (const c of res.corrections || []) {
    const s = segs[c.seg], hit = byLower.get((c.write || "").trim().toLowerCase());
    if (!s || !hit || !c.heard || c.heard.length > 60) continue;           // só aceita grafias que existem no vocabulário
    const heard = clean(c.heard), w = clean(hit.it.w);
    if (heard.toLowerCase() === w.toLowerCase()) continue;
    const tag = hit.kind === "ja" ? m => `{ja:${w}|${clean(hit.it.k || "")}}` : hit.kind === "en" ? m => `{en:${w}|${m}}` : m => `{fix:${w}|${m}}`;
    if (replaceOnce(s, heard, tag)) {
      hit.it.n = (hit.it.n || 0) + 1;
      if (!hit.it.was.some(x => x.toLowerCase() === heard.toLowerCase()) && hit.it.was.length < 12) hit.it.was.push(heard);
      changed = true;
    }
  }
  segs.forEach(highlightForeign);
  const known = new Set([...byLower.keys(), ...Object.values(VOCAB).flat().flatMap(i => i.was.map(x => x.toLowerCase()))]);
  f.unknown = [];
  for (const u of res.unknown || []) {
    const s = segs[u.seg], h = clean(u.heard || "");
    if (!s || !h || h.length > 40 || known.has(h.toLowerCase())) continue;
    if (replaceOnce(s, h, m => `{?:${m}}`) && !f.unknown.includes(h)) f.unknown.push(h);
  }
  const people = new Set(VOCAB.pessoas.map(p => p.w));
  for (const sp of res.speakers || []) if (spIds.includes(sp.id) && sp.name && !f.tr.speakers[sp.id]) f.tr.speakers[sp.id] = people.has(sp.name) ? sp.name : sp.name.slice(0, 30);
  for (const u of f.unknown) if (!SUGG.some(x => x.w.toLowerCase() === u.toLowerCase())) SUGG.push({w: u, file: f.id});
  SUGG = SUGG.slice(-40);
  await kv("sugg", SUGG);
  if (changed) await saveVocab();
}

/* ---------- etapa 2: resumo no modelo escolhido, com referência a cada trecho ---------- */
const SUM_SCHEMA = {type:"object", additionalProperties:false, required:["title","snippet","sections","mind"], properties:{
  title:{type:"string"}, snippet:{type:"string"},
  sections:{type:"array", items:{type:"object", additionalProperties:false, required:["heading","style","items"], properties:{
    heading:{type:"string"}, style:{type:"string", enum:["bullets","numbered","paragraph"]},
    items:{type:"array", items:{type:"object", additionalProperties:false, required:["text","refs","unsure"], properties:{
      text:{type:"string"}, refs:{type:"array", items:{type:"integer"}}, unsure:{type:"boolean"}}}}}}},
  mind:{type:"object", additionalProperties:false, required:["root","branches"], properties:{root:{type:"string"},
    branches:{type:"array", items:{type:"object", additionalProperties:false, required:["label","leaves"], properties:{label:{type:"string"}, leaves:{type:"array", items:{type:"string"}}}}}}},
}};
async function summarize(f, tplName) {
  const tpl = tplOf(tplName);
  const res = await claude({system: SYS, effort: "high", max: 32000, schema: SUM_SCHEMA, content:
`${ctxText(f)}

VOCABULÁRIO (use exatamente estas grafias; termos em japonês e inglês ficam no original):
${vocabText()}

TRANSCRIÇÃO (cada linha: #número [tempo] falante: texto):
${trText(f)}

Escreva o resumo no modelo "${tpl.name}".
Instruções do modelo: ${tpl.guide}

Regras:
- Cada item precisa de "refs": os números das linhas (#) que sustentam o que está escrito. Use 1 a 3 linhas, as mais diretas.
- Escreva só o que foi dito. Se algo ficou ambíguo no áudio (nome, número, data, quem vai fazer), escreva do jeito mais fiel e marque "unsure": true.
- Frases curtas e claras, sem enrolação. Não repita a mesma informação em duas seções. Omita seções vazias.
- "title": título curto e específico (até 60 caracteres), sem data. "snippet": 1 ou 2 frases com o essencial.
- "mind": mapa mental com raiz de até 3 palavras, 3 a 6 ramos e até 4 folhas curtas por ramo.`});
  const n = f.tr.segs.length;
  for (const s of res.sections || []) for (const it of s.items || []) it.refs = [...new Set((it.refs || []).filter(r => r >= 0 && r < n))].slice(0, 4);
  return {tpl: tpl.name, at: Date.now(), model: CFG.model, ...res};
}

/* ---------- etapa 3: conferência de cada item contra a transcrição ---------- */
const CHECK_SCHEMA = {type:"object", additionalProperties:false, required:["unsupported"], properties:{
  unsupported:{type:"array", items:{type:"object", additionalProperties:false, required:["id","why"], properties:{id:{type:"string"}, why:{type:"string"}}}}}};
async function verify(f) {
  const items = [];
  f.sum.sections.forEach((s, a) => s.items.forEach((it, b) => items.push(`S${a}.${b}: ${it.text} (linhas ${it.refs.map(r => "#" + r).join(", ") || "nenhuma"})`)));
  if (!items.length) return;
  const res = await claude({system: SYS, effort: "medium", max: 16000, schema: CHECK_SCHEMA, content:
`TRANSCRIÇÃO:
${trText(f)}

ITENS DO RESUMO:
${items.join("\n")}

Confira cada item contra a transcrição. Liste em "unsupported" só os itens que afirmam algo que a transcrição não sustenta: nome trocado, número ou data diferente, decisão que não foi tomada, responsável que não foi dito, ou conclusão exagerada. Paráfrase fiel está certa. "why" explica em uma frase curta o que não bate.`});
  for (const u of res.unsupported || []) {
    const m = /^S(\d+)\.(\d+)$/.exec(u.id || ""); if (!m) continue;
    const it = f.sum.sections[+m[1]]?.items[+m[2]]; if (it) { it.unsure = true; it.why = u.why; }
  }
}

/* ---------- geração completa ---------- */
const STAGES = [["stt", "Transcrevendo com o vocabulário"], ["fix", "Corrigindo nomes e termos"], ["sum", "Escrevendo o resumo"], ["check", "Conferindo cada item com o áudio"]];
async function generate(f, from) {
  if (RUN[f.id]) return;
  if (!CFG.anKey || (!f.tr && !CFG.elKey) || (from === "stt" && !CFG.elKey)) {
    toast("Coloque as chaves das APIs em Eu › Chaves"); S.tab = "me"; S.open = null; render(); return;
  }
  const tpl = f.tpl || folderOf(f.folder)?.tpl || "Resumo livre";
  const set = st => { RUN[f.id] = st; if (S.open === f.id) render(true); else if (!S.open && S.tab === "files") render(true); };
  f.status = "run"; f.err = null; await saveFile(f);
  try {
    if (!f.tr || from === "stt") {
      set("stt");
      const r = await transcribeEL(f);
      f.tr = {segs: buildSegs(r.words, r.text), speakers: {}, lang: r.lang};
      if (!f.dur) f.dur = r.end;
      if (!f.tr.segs.length) throw new Error("Não foi encontrada fala neste áudio.");
      delete f.sum; await saveFile(f);
    }
    if (!f.tr.fixed || from === "fix") { set("fix"); await fixPass(f); f.tr.fixed = true; await saveFile(f); }
    set("sum"); f.sum = await summarize(f, tpl); await saveFile(f);
    set("check"); await verify(f);
    if (f.autoTitle && f.sum.title) f.title = f.sum.title.slice(0, 80);
    f.status = "ok";
  } catch (e) {
    f.status = "err"; f.err = e.message || String(e);
  }
  f._plain = null; delete RUN[f.id];
  await saveFile(f);
  render(true);
  if (f.status === "ok") toast("Pronto: " + f.title);
}

/* ---------- perguntas ---------- */
const ASK_SCHEMA = {type:"object", additionalProperties:false, required:["answer","refs"], properties:{
  answer:{type:"string"}, refs:{type:"array", items:{type:"object", additionalProperties:false, required:["file","seg"], properties:{file:{type:"string"}, seg:{type:"integer"}}}}}};
async function ask(question, scopeFiles, history) {
  let budget = 2_400_000, blocks = [];
  for (const f of scopeFiles) {
    const b = `=== ARQUIVO ${f.id}: ${f.title} (${dmy(f.created)} ${hm(f.created)}${f.folder ? ", pasta " + f.folder : ""}) ===\n${trText(f)}`;
    if (b.length > budget) break; budget -= b.length; blocks.push(b);
  }
  const hist = history.slice(-6).map(h => `Pergunta: ${h.q}\nResposta: ${h.a}`).join("\n\n");
  return claude({system: SYS, effort: "medium", max: 16000, schema: ASK_SCHEMA, content:
`CONTEXTO DO USUÁRIO:\n${CFG.context}\n\nVOCABULÁRIO:\n${vocabText()}\n\nGRAVAÇÕES:\n${blocks.join("\n\n") || "(nenhuma gravação transcrita)"}\n\n${hist ? "CONVERSA ATÉ AQUI:\n" + hist + "\n\n" : ""}PERGUNTA: ${question}

Responda de forma direta e curta, só com base nas gravações. Se a resposta não estiver nelas, diga isso. Em "refs", aponte os trechos que sustentam a resposta (id do arquivo e número da linha #), até 5.`});
}

/* ---------- interface ---------- */
function render(keepScroll) {
  $$("#tb [data-tab]").forEach(b => b.setAttribute("aria-current", String(b.dataset.tab === S.tab && !S.open)));
  const sc = $("#screen"), top = sc.scrollTop;
  $("#tb").hidden = !!S.open;
  if (S.open && fileById(S.open)) { sc.innerHTML = detail(); bindDetail(); }
  else if (S.tab === "files") { S.open = null; sc.innerHTML = filesView(); bindFiles(); }
  else if (S.tab === "vocab") { sc.innerHTML = vocabView(); bindVocab(); }
  else if (S.tab === "ask") { sc.innerHTML = askView(); bindAsk(); }
  else { sc.innerHTML = meView(); bindMe(); }
  sc.scrollTop = keepScroll ? top : 0;
}
function toast(m, ms = 2600) { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; $("#phone").appendChild(t); setTimeout(() => t.remove(), ms); }
function sheet(html) {
  const l = $("#layer");
  l.innerHTML = `<div class="scrim"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const s = l.querySelector(".scrim"); s.onclick = e => { if (e.target === s && !s.dataset.lock) close(); };
  const i = s.querySelector("input:not([type=hidden]),textarea"); if (i && !i.value) setTimeout(() => i.focus(), 50);
  return s;
}
const close = () => { $("#layer").innerHTML = ""; };
const tog = (on, id, label) => `<button class="tog" role="switch" id="${id}" aria-checked="${!!on}" aria-label="${esc(label)}"></button>`;

/* Arquivos */
function inFolder(f, folder) {
  if (folder === "trash") return !!f.trashed;
  if (f.trashed) return false;
  return folder === "all" || (folder === "none" ? !f.folder : f.folder === folder);
}
const folderLabel = k => k === "all" ? "Todos os arquivos" : k === "none" ? "Sem pasta" : k === "trash" ? "Lixeira" : k;
function searchText(f) {
  if (!f._plain) f._plain = (f.title + " " + (f.sum?.snippet || "") + " " + (f.sum?.sections || []).map(s => s.heading + " " + s.items.map(i => i.text).join(" ")).join(" ") + " " + (f.tr?.segs || []).map(s => plain(s.text)).join(" ")).toLowerCase();
  return f._plain;
}
function statusTag(f) {
  if (RUN[f.id]) return `<span class="tag run">Gerando…</span>`;
  if (f.status === "ok" && f.sum) return `<span class="tag ai">✦ Resumo</span>`;
  if (f.status === "err") return `<span class="tag err">Erro</span>`;
  if (f.tr) return `<span class="tag fold">Transcrito</span>`;
  return `<span class="tag wait">Gerar</span>`;
}
function filesView() {
  let list = files.filter(f => inFolder(f, S.folder));
  if (S.filter === "Prontos") list = list.filter(f => f.sum);
  if (S.filter === "Sem transcrição") list = list.filter(f => !f.sum);
  if (S.q) { const q = S.q.toLowerCase().trim(); list = list.filter(f => searchText(f).includes(q)); }
  const selecting = !!S.sel;
  let h = `<div class="nb"><div class="t"><button class="fsw" id="fsw">${esc(folderLabel(S.folder))} ▾</button><h1 class="big">${S.folder === "trash" ? "Lixeira" : "Arquivos"}</h1></div>
    <button class="ib" id="sel" aria-label="${selecting ? "Concluir seleção" : "Selecionar vários"}">${selecting ? "✓" : "☰"}</button></div>
    <label class="search"><span>⌕</span><input id="q" type="search" placeholder="Buscar em títulos, resumos e transcrições" value="${esc(S.q)}"></label>
    <div class="chips">${["Todos", "Prontos", "Sem transcrição"].map(c => `<button class="chip" aria-pressed="${S.filter === c}">${c}</button>`).join("")}</div>`;
  let g = "";
  for (const f of list) {
    const gr = dateLabel(f.created); if (gr !== g) { h += `<div class="group">${esc(gr)}</div>`; g = gr; }
    const on = selecting && S.sel.has(f.id);
    h += `<div class="file${selecting ? " sel" : ""}" role="button" tabindex="0" data-id="${f.id}" ${selecting ? `aria-checked="${on}"` : ""}>${selecting ? `<span class="ck">${on ? "✓" : ""}</span>` : ""}<h3>${esc(f.title)}</h3>
      <div class="fmeta"><span>${hm(f.created)}</span><span class="dot"></span><span>${fmt(f.dur)}</span>${f.folder && S.folder === "all" ? `<span class="tag fold">${esc(f.folder)}</span>` : ""}${statusTag(f)}</div>
      ${f.sum?.snippet ? `<div class="snip">${esc(f.sum.snippet)}</div>` : ""}${selecting ? "" : `<button class="fmore" data-more="${f.id}" aria-label="Mais opções">⋯</button>`}</div>`;
  }
  if (!files.length) h += `<div class="empty"><b>Nenhuma gravação ainda</b><span>Toque no + para importar um áudio exportado do app da Plaud ou gravar pelo iPhone.</span>${!CFG.anKey || !CFG.elKey ? `<button class="gbtn" id="gokeys">Colocar as chaves das APIs</button>` : ""}</div>`;
  else if (!list.length) h += `<p class="note">${S.folder === "trash" ? "A lixeira está vazia." : "Nenhum arquivo aqui."}</p>`;
  if (selecting) h += `<div style="height:80px"></div>`;
  return h;
}
function bindFiles() {
  $("#fsw").onclick = folderSheet;
  $("#sel").onclick = () => { S.sel = S.sel ? null : new Set(); render(true); selBar(); };
  const q = $("#q"); q.oninput = e => { S.q = e.target.value; const p = q.selectionStart; render(true); const n = $("#q"); n.focus(); n.setSelectionRange(p, p); };
  $$(".chips .chip").forEach(c => c.onclick = () => { S.filter = c.textContent; render(); });
  $$(".file").forEach(r => {
    r.onclick = e => {
      if (e.target.closest(".fmore")) return;
      if (S.sel) { S.sel.has(r.dataset.id) ? S.sel.delete(r.dataset.id) : S.sel.add(r.dataset.id); render(true); selBar(); return; }
      openFile(r.dataset.id);
    };
    r.onkeydown = e => { if (e.key === "Enter") r.click(); };
  });
  $$("[data-more]").forEach(b => b.onclick = e => { e.stopPropagation(); moreSheet(b.dataset.more); });
  const gk = $("#gokeys"); if (gk) gk.onclick = () => { S.tab = "me"; render(); };
  if (S.sel) selBar();
}
function selBar() {
  $(".selbar")?.remove();
  if (!S.sel) return;
  const n = S.sel.size, bar = document.createElement("div"); bar.className = "selbar";
  const trash = S.folder === "trash";
  bar.innerHTML = trash
    ? `<button id="sr" ${n ? "" : "disabled"}>Restaurar (${n})</button><button id="sx" class="danger" ${n ? "" : "disabled"}>Apagar de vez</button>`
    : `<button id="sm" ${n ? "" : "disabled"}>Mover (${n})</button><button id="sg" ${n ? "" : "disabled"}>✦ Gerar</button><button id="sd" class="danger" ${n ? "" : "disabled"}>Excluir</button>`;
  $("#phone").appendChild(bar);
  const ids = () => [...S.sel], done = () => { S.sel = null; bar.remove(); render(true); };
  if (trash) {
    bar.querySelector("#sr").onclick = async () => { for (const id of ids()) { const f = fileById(id); f.trashed = false; await saveFile(f); } toast("Restaurado"); done(); };
    bar.querySelector("#sx").onclick = () => confirmSheet(`Apagar ${n} de vez?`, "O áudio e o texto saem deste aparelho e não podem ser recuperados.", "Apagar", async () => { for (const id of ids()) await purge(id); done(); });
  } else {
    bar.querySelector("#sm").onclick = () => moveSheet(ids(), done);
    bar.querySelector("#sg").onclick = () => { const l = ids().map(fileById).filter(f => !f.sum); done(); runQueue(l); };
    bar.querySelector("#sd").onclick = async () => { for (const id of ids()) { const f = fileById(id); f.trashed = true; await saveFile(f); } toast("Movido para a lixeira"); done(); };
  }
}
async function runQueue(list) {
  if (!list.length) { toast("Todos já têm resumo"); return; }
  toast(`Gerando ${list.length} ${list.length > 1 ? "arquivos" : "arquivo"}, um de cada vez`);
  for (const f of list) await generate(f);
}
function folderSheet() {
  const keys = ["all", "none", ...FOLDERS.map(f => f.name)];
  const n = k => files.filter(x => inFolder(x, k)).length;
  const s = sheet(`<h3>Pastas</h3>${keys.map(k => `<button class="srow" data-f="${esc(k)}" aria-checked="${S.folder === k}"><span class="ic">${k === "all" ? "◎" : k === "none" ? "◌" : "▢"}</span>${esc(folderLabel(k))}<span class="r">${S.folder === k ? "✓" : n(k)}</span></button>`).join("")}
    <button class="srow" id="nf"><span class="ic">＋</span>Nova pasta</button>
    <button class="srow" id="ef"><span class="ic">✎</span>Editar pastas</button>
    <button class="srow" data-f="trash"><span class="ic">⌫</span>Lixeira<span class="r">${n("trash")}</span></button>`);
  s.querySelectorAll("[data-f]").forEach(b => b.onclick = () => { S.folder = b.dataset.f; S.sel = null; close(); render(); });
  s.querySelector("#nf").onclick = () => folderEdit(null);
  s.querySelector("#ef").onclick = () => {
    const t = sheet(`<h3>Editar pastas</h3><p class="sub">Cada pasta tem uma descrição e um modelo de resumo. O Claude usa os dois.</p>${FOLDERS.map((f, i) => `<button class="srow" data-i="${i}"><span class="ic">▢</span>${esc(f.name)}<span class="r">${esc(f.tpl)} ›</span></button>`).join("")}`);
    t.querySelectorAll("[data-i]").forEach(b => b.onclick = () => folderEdit(+b.dataset.i));
  };
}
function folderEdit(i) {
  const f = i === null ? {name: "", desc: "", tpl: "Resumo livre"} : FOLDERS[i];
  const s = sheet(`<h3>${i === null ? "Nova pasta" : "Editar pasta"}</h3>
    <div class="field"><label for="fn">Nome</label><input id="fn" value="${esc(f.name)}" placeholder="Ex.: Reuniões com sócios"></div>
    <div class="field"><label for="fd">Sobre esta pasta</label><textarea id="fd" placeholder="Ex.: Reuniões semanais com a gestão. Foco em decisões e responsáveis.">${esc(f.desc)}</textarea><span class="hint">O Claude lê isto antes de resumir as gravações da pasta.</span></div>
    <div class="field"><label for="ft">Modelo de resumo padrão</label><select id="ft">${allTemplates().map(t => `<option ${t.name === f.tpl ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
    <button class="primary" id="fs">Salvar</button>${i === null ? "" : `<button class="srow danger" id="fx" style="justify-content:center;margin-top:8px">Excluir pasta</button>`}`);
  s.querySelector("#fs").onclick = async () => {
    const name = s.querySelector("#fn").value.trim(); if (!name) { toast("Dê um nome à pasta"); return; }
    if (["all", "none", "trash"].includes(name) || FOLDERS.some((x, j) => x.name === name && j !== i)) { toast("Já existe uma pasta com esse nome"); return; }
    const old = f.name; Object.assign(f, {name, desc: s.querySelector("#fd").value.trim(), tpl: s.querySelector("#ft").value});
    if (i === null) FOLDERS.push(f);
    else if (old !== name) { for (const x of files.filter(x => x.folder === old)) { x.folder = name; await saveFile(x); } if (S.folder === old) S.folder = name; }
    await saveFolders(); close(); render(true); toast("Pasta salva");
  };
  const fx = s.querySelector("#fx");
  if (fx) fx.onclick = () => confirmSheet(`Excluir “${f.name}”?`, "Os arquivos dela vão para Sem pasta. Nada é apagado.", "Excluir pasta", async () => {
    for (const x of files.filter(x => x.folder === f.name)) { x.folder = null; await saveFile(x); }
    FOLDERS.splice(i, 1); if (S.folder === f.name) S.folder = "all"; await saveFolders(); render(true);
  });
}
function confirmSheet(title, sub, label, fn) {
  const s = sheet(`<h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p><button class="primary" id="ok" style="background:var(--ja)">${esc(label)}</button><button class="srow" id="no" style="justify-content:center">Cancelar</button>`);
  s.querySelector("#ok").onclick = async () => { close(); await fn(); };
  s.querySelector("#no").onclick = close;
}
function moreSheet(id) {
  const f = fileById(id);
  if (f.trashed) {
    const s = sheet(`<h3>${esc(f.title)}</h3><p class="sub">Na lixeira</p><button class="srow" id="rs"><span class="ic">↺</span>Restaurar</button><button class="srow danger" id="px"><span class="ic danger">⌫</span>Apagar de vez</button>`);
    s.querySelector("#rs").onclick = async () => { f.trashed = false; await saveFile(f); close(); render(true); toast("Restaurado"); };
    s.querySelector("#px").onclick = () => confirmSheet("Apagar de vez?", "O áudio e o texto saem deste aparelho.", "Apagar", async () => { await purge(id); S.open = null; render(true); });
    return;
  }
  const s = sheet(`<h3>${esc(f.title)}</h3><p class="sub">${dmy(f.created)} ${hm(f.created)} · ${fmt(f.dur)}</p>
    <button class="srow" data-a="mv"><span class="ic">↦</span>Mover para pasta<span class="r">${esc(f.folder || "Sem pasta")}</span></button>
    <button class="srow" data-a="rn"><span class="ic">Aa</span>Renomear</button>
    ${f.sum ? "" : `<button class="srow" data-a="gen"><span class="ic spark">✦</span>Gerar transcrição e resumo</button>`}
    ${f.tr ? `<button class="srow" data-a="ex"><span class="ic">⇪</span>Exportar texto</button>` : ""}
    ${f.hasAudio ? `<button class="srow" data-a="au"><span class="ic">♫</span>Salvar o áudio em Arquivos</button>` : ""}
    <button class="srow" data-a="where"><span class="ic">ⓘ</span>Onde está salvo</button>
    <button class="srow danger" data-a="del"><span class="ic danger">⌫</span>Excluir</button>`);
  s.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
    const a = b.dataset.a;
    if (a === "mv") moveSheet([id]);
    else if (a === "rn") renameSheet(f);
    else if (a === "gen") { close(); openFile(id); genSheet(f); }
    else if (a === "ex") { close(); exportText(f); }
    else if (a === "au") { close(); exportAudio(f); }
    else if (a === "where") sheet(`<h3>Onde está salvo</h3><p>O áudio, a transcrição e o resumo ficam guardados <b>dentro do Escuta, neste iPhone</b>, na pasta “${esc(f.folder || "Sem pasta")}”. Nada vai para um servidor nosso.</p><p class="sub">O áudio só sai do aparelho na hora de transcrever (vai para o ElevenLabs) e o texto vai para o Claude na hora do resumo.</p><p class="sub">Para ter uma cópia fora do app, use “Salvar o áudio em Arquivos” e, em Eu › Backup, salve o backup dos textos.</p>`);
    else if (a === "del") { f.trashed = true; await saveFile(f); close(); S.open = null; render(true); toast("Movido para a lixeira"); }
  });
}
function renameSheet(f) {
  const s = sheet(`<h3>Renomear</h3><div class="field"><input id="rn" value="${esc(f.title)}" aria-label="Nome"></div><button class="primary" id="ok">Salvar</button>`);
  const i = s.querySelector("#rn"); i.focus(); i.select();
  s.querySelector("#ok").onclick = async () => { const v = i.value.trim(); if (!v) return; f.title = v; f.autoTitle = false; f._plain = null; await saveFile(f); close(); render(true); };
}
function moveSheet(ids, after) {
  const fs = ids.map(fileById), cur = fs.length === 1 ? (fs[0].folder || "Sem pasta") : null;
  const s = sheet(`<h3>Mover para</h3><p class="sub">${fs.length > 1 ? fs.length + " arquivos. " : ""}O áudio, a transcrição e o resumo vão juntos.</p>${["Sem pasta", ...FOLDERS.map(f => f.name)].map(n => `<button class="srow" data-to="${esc(n)}" aria-checked="${cur === n}"><span class="ic">▢</span>${esc(n)}<span class="r">${cur === n ? "✓" : ""}</span></button>`).join("")}<button class="srow" id="nf"><span class="ic">＋</span>Nova pasta</button>`);
  s.querySelectorAll("[data-to]").forEach(b => b.onclick = async () => {
    for (const f of fs) { f.folder = b.dataset.to === "Sem pasta" ? null : b.dataset.to; await saveFile(f); }
    close(); after ? after() : render(true); toast("Movido para " + b.dataset.to);
  });
  s.querySelector("#nf").onclick = () => folderEdit(null);
}
async function purge(id) {
  await DB.del("files", id); await DB.del("audio", id);
  files = files.filter(f => f.id !== id);
}

/* Detalhe */
let audioFor = null, audioUrl = null;
async function openFile(id) {
  S.open = id; S.seg = "sum"; S.edit = false; render();
  const f = fileById(id), a = $("#audio");
  if (audioFor !== id) {
    a.pause(); if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; a.removeAttribute("src"); audioFor = id;
    const blob = f.hasAudio ? await DB.get("audio", id) : null;
    if (blob && S.open === id) { audioUrl = URL.createObjectURL(blob); a.src = audioUrl; a.playbackRate = speed; }
  }
  syncPlayer();
}
let speed = 1;
function detail() {
  const f = fileById(S.open), st = RUN[f.id];
  let h = `<div class="dnb"><div class="drow"><button class="back" id="back">‹ ${esc(S.tab === "ask" ? "Perguntar" : "Arquivos")}</button><span style="flex:1"></span><button class="ib" data-more="${f.id}" aria-label="Mais opções">⋯</button></div></div>
    <div class="dtitle"><h1>${esc(f.title)}</h1><div class="fmeta"><span>${dmy(f.created)} ${hm(f.created)}</span><span class="dot"></span><span>${fmt(f.dur)}</span>${f.folder ? `<span class="tag fold">${esc(f.folder)}</span>` : ""}</div></div>`;
  if (!f.tr) {
    h += `<div class="body">${st ? progressCard(st) : f.status === "err" ? `<div class="gen"><h2>Não deu certo</h2><div class="errbox">${esc(f.err)}</div><button class="gbtn" id="gen">Tentar de novo</button></div>`
      : `<div class="gen"><h2>Ainda sem transcrição</h2><p>${f.hasAudio ? "Transcrição com o seu vocabulário, identificação de quem fala e resumo pelo Claude. Sem limite de minutos." : "Este arquivo veio de um backup e o áudio não está neste aparelho."}</p>${f.hasAudio ? `<button class="gbtn" id="gen">✦ Gerar</button>` : ""}</div>`}</div>`;
    return h + dock(f);
  }
  h += `<div class="seg" role="tablist">${[["sum", "Resumo"], ["tr", "Transcrição"], ["mm", "Mapa mental"]].map(([k, n]) => `<button role="tab" data-s="${k}" aria-selected="${S.seg === k}">${n}</button>`).join("")}</div><div class="body">`;
  if (S.seg === "sum") {
    if (st) h += progressCard(st);
    else if (f.sum) h += `<div class="aibar"><button class="tplbtn" id="tpl"><span class="spark">✦</span>${esc(f.sum.tpl)} ▾</button><span>Toque no horário para ouvir o trecho</span></div><article class="sum">${sumHTML(f)}</article><p class="note" style="padding:14px 0">${esc(MODELS[f.sum.model]?.label || f.sum.model)} · ${dmy(f.sum.at)}</p>`;
    else h += f.status === "err" ? `<div class="gen"><h2>O resumo não foi feito</h2><div class="errbox">${esc(f.err)}</div><p>A transcrição está salva. Tentar de novo não cobra a transcrição outra vez.</p><button class="gbtn" id="gen">Tentar de novo</button></div>`
      : `<div class="gen"><h2>Sem resumo</h2><p>A transcrição está pronta.</p><button class="gbtn" id="gen">✦ Gerar resumo</button></div>`;
  }
  if (S.seg === "tr") {
    h += `<div class="aibar"><button class="tplbtn" id="edt">${S.edit ? "✓ Concluir edição" : "✎ Corrigir texto"}</button><span>${S.edit ? "Toque numa fala para corrigir" : "Toque no nome para dizer quem é"}</span></div>
      <div class="legend"><span><i class="sw" style="background:var(--fix)"></i>Corrigido pelo vocabulário</span><span><i class="sw" style="background:var(--en-soft)"></i>Inglês</span><span><i class="sw" style="background:var(--ja-soft)"></i>Japonês</span><span><i class="sw" style="background:var(--warn-soft)"></i>Não reconhecido</span></div>`;
    const spList = [...new Set(f.tr.segs.map(s => s.sp))];
    f.tr.segs.forEach((s, i) => {
      const n = spName(f, s.sp), c = COLORS[spList.indexOf(s.sp) % COLORS.length];
      h += `<div class="line" id="L${i}" data-i="${i}"><div class="who"><span class="av" style="background:${c}">${esc(n.charAt(0).toUpperCase())}</span><span class="sp" data-sp="${esc(s.sp)}">${esc(n)}</span><span class="when">${fmt(s.t)}</span></div><div>${marked(s.text)}</div></div>`;
    });
  }
  if (S.seg === "mm") h += f.sum?.mind ? mindHTML(f.sum.mind) : `<p class="note" style="padding:0">O mapa mental aparece depois do resumo.</p>`;
  return h + `</div>` + dock(f);
}
function progressCard(st) {
  const idx = STAGES.findIndex(x => x[0] === st);
  return `<div class="gen"><h2>Gerando…</h2><div class="prog"><i></i></div><div class="steps">${STAGES.map(([k, n], i) => `<div class="${i < idx ? "s-ok" : i === idx ? "s-run" : "s-wait"}">${i < idx ? "✓" : i === idx ? "●" : "○"} ${n}</div>`).join("")}</div><p>Deixe o app aberto até terminar. No iPhone, sair do app pode interromper.</p></div>`;
}
function dock(f) {
  if (!f.hasAudio && !f.tr) return "";
  return `<div class="dock">${f.hasAudio ? `<div class="prow"><button class="pp" id="pp" aria-label="Tocar">▶</button><div class="track" id="track"><i></i><b></b></div><span class="ptime" id="ptime">00:00 / ${fmt(f.dur)}</span><button class="spd" id="spd">${speed}×</button></div>` : ""}${f.tr ? `<button class="ask" id="ask"><span class="spark">✦</span>Pergunte sobre esta gravação</button>` : ""}</div>`;
}
const T = (f, i) => f.tr.segs[i] ? `<button class="ts" data-i="${i}">${fmt(f.tr.segs[i].t)}</button>` : "";
function sumHTML(f) {
  let h = "";
  for (const s of f.sum.sections) {
    const item = it => italicTerms(esc(it.text)) + it.refs.map(r => T(f, r)).join("") + (it.unsure ? `<span class="conf" tabindex="0" title="${esc(it.why || "Não ficou claro no áudio")}" data-why="${esc(it.why || "Não ficou claro no áudio. Ouça o trecho para confirmar.")}">a confirmar</span>` : "");
    h += `<h2>${esc(s.heading)}</h2>`;
    if (s.style === "paragraph") h += s.items.map(it => `<p>${item(it)}</p>`).join("");
    else { const tag = s.style === "numbered" ? "ol" : "ul"; h += `<${tag}>${s.items.map(it => `<li>${item(it)}</li>`).join("")}</${tag}>`; }
  }
  if (f.unknown?.length) h += `<h2>Palavras não reconhecidas</h2><p>${f.unknown.map(u => `<span class="tbd" data-add="${esc(u)}">${esc(u)}</span>`).join(" ")}</p><p style="color:var(--sub);font-size:14px">Toque para adicionar ao vocabulário. A próxima gravação já sai certa.</p>`;
  return h;
}
function mindHTML(m) {
  return `<div class="tree"><span class="rootn">${esc(m.root)}</span>${(m.branches || []).map(b => `<div class="br"><b>${esc(b.label)}</b>${(b.leaves || []).map(l => `<span>${esc(l)}</span>`).join("")}</div>`).join("")}</div>`;
}
function bindDetail() {
  const f = fileById(S.open), a = $("#audio");
  $("#back").onclick = () => { S.open = null; a.pause(); render(); };
  $$("[data-more]").forEach(b => b.onclick = () => moreSheet(b.dataset.more));
  $$("[data-s]").forEach(b => b.onclick = () => { S.seg = b.dataset.s; render(true); syncPlayer(); });
  const g = $("#gen"); if (g) g.onclick = () => f.tr ? generate(f) : genSheet(f);
  const tp = $("#tpl"); if (tp) tp.onclick = () => tplSheet(f);
  $$(".ts").forEach(b => b.onclick = e => { e.stopPropagation(); jump(+b.dataset.i); });
  $$(".conf").forEach(c => c.onclick = () => toast(c.dataset.why, 4000));
  $$("[data-add]").forEach(t => t.onclick = () => addWord(t.dataset.add));
  const ed = $("#edt"); if (ed) ed.onclick = () => { S.edit = !S.edit; render(true); };
  $$(".sp").forEach(x => x.onclick = e => { e.stopPropagation(); speakerSheet(f, x.dataset.sp); });
  $$(".line").forEach(l => l.onclick = e => {
    const q = e.target.closest(".w-q"); if (q && !S.edit) { addWord(q.textContent); return; }
    if (S.edit) editLine(f, +l.dataset.i); else seek(f.tr.segs[+l.dataset.i].t, true);
  });
  const pp = $("#pp"); if (pp) pp.onclick = () => { a.paused ? a.play().catch(() => toast("Não consegui tocar este formato de áudio")) : a.pause(); };
  const tr = $("#track"); if (tr) tr.onclick = e => { const r = tr.getBoundingClientRect(), d = a.duration || f.dur; if (d) seek((e.clientX - r.left) / r.width * d, false); };
  const sp = $("#spd"); if (sp) sp.onclick = () => { speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1; a.playbackRate = speed; sp.textContent = speed + "×"; };
  const ak = $("#ask"); if (ak) ak.onclick = () => askSheet(f);
  syncPlayer();
}
function seek(t, play) { const a = $("#audio"); if (!a.src) return; a.currentTime = t; if (play) a.play().catch(() => {}); syncPlayer(); }
function jump(i) {
  const f = fileById(S.open); S.seg = "tr"; S.edit = false; render();
  const l = $("#L" + i); if (l) l.scrollIntoView({block: "center"});
  seek(f.tr.segs[i].t, true);
}
let hotLine = -1;
function syncPlayer() {
  const a = $("#audio"), f = S.open && fileById(S.open); if (!f) return;
  const d = (isFinite(a.duration) && a.duration) || f.dur || 1, p = Math.min(100, a.currentTime / d * 100);
  const tr = $("#track"); if (tr) { tr.querySelector("i").style.width = p + "%"; tr.querySelector("b").style.left = p + "%"; }
  const pt = $("#ptime"); if (pt) pt.textContent = `${fmt(a.currentTime)} / ${fmt(d)}`;
  const pp = $("#pp"); if (pp) { pp.textContent = a.paused ? "▶" : "❚❚"; pp.setAttribute("aria-label", a.paused ? "Tocar" : "Pausar"); }
  if (f.tr && S.seg === "tr" && !a.paused) {
    let i = -1; for (let k = 0; k < f.tr.segs.length; k++) { if (f.tr.segs[k].t <= a.currentTime + 0.2) i = k; else break; }
    if (i !== hotLine) { $$(".line.hot").forEach(x => x.classList.remove("hot")); const l = $("#L" + i); if (l) l.classList.add("hot"); hotLine = i; }
  }
}
function genSheet(f) {
  const tpl = f.tpl || folderOf(f.folder)?.tpl || "Resumo livre", e = estimate(f);
  const s = sheet(`<h3>Gerar</h3><p class="sub">${esc(f.title)} · ${fmt(f.dur)}</p>
    <div class="opt"><span>Idioma principal</span><span class="v">${CFG.lang === "pt" ? "Português (Brasil)" : "Automático"}</span></div>
    <div class="opt"><span>Termos estrangeiros</span><span class="v">Inglês e japonês, pelo vocabulário</span></div>
    <div class="opt"><span>Vocabulário<br><small>${VOCAB.pessoas.length} pessoas, ${VOCAB.ja.length + VOCAB.en.length} termos estrangeiros, ${VOCAB.lugares.length} lugares</small></span><span class="v">${vcount()} termos</span></div>
    <div class="opt"><span>Identificar quem fala</span>${tog(CFG.speakers, "gsp", "Identificar quem fala")}</div>
    <div class="opt"><span>Modelo do resumo</span><select id="gtp" style="font:inherit;color:var(--ink);background:var(--fill);border:0;border-radius:8px;padding:6px 8px;max-width:55%">${allTemplates().map(t => `<option ${t.name === tpl ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
    <div class="opt"><span>Custo estimado<br><small>transcrição ${usd(e.stt)} + Claude ${usd(e.cl)}</small></span><span class="v">≈ ${usd(e.total)}</span></div>
    <button class="gbtn" id="go" style="margin-top:12px">✦ Gerar</button>`);
  s.querySelector("#gsp").onclick = async ev => { CFG.speakers = !CFG.speakers; ev.target.setAttribute("aria-checked", String(CFG.speakers)); await saveCfg(); };
  s.querySelector("#go").onclick = async () => { f.tpl = s.querySelector("#gtp").value; await saveFile(f); close(); generate(f); };
}
function tplSheet(f) {
  const cur = f.sum?.tpl;
  const s = sheet(`<h3>Modelo do resumo</h3><p class="sub">O Claude reescreve o resumo neste formato. A transcrição não é cobrada de novo.</p>${allTemplates().map(t => `<button class="srow" data-t="${esc(t.name)}" aria-checked="${t.name === cur}">${esc(t.name)}<span class="r">${t.name === cur ? "✓" : ""}</span></button>`).join("")}<button class="srow" id="nt"><span class="ic">＋</span>Criar meu modelo</button>`);
  s.querySelectorAll("[data-t]").forEach(b => b.onclick = async () => { close(); f.tpl = b.dataset.t; await saveFile(f); regenSummary(f); });
  s.querySelector("#nt").onclick = () => tplEdit(f);
}
async function regenSummary(f) {
  if (!CFG.anKey) { toast("Coloque a chave do Claude em Eu › Chaves"); return; }
  if (RUN[f.id]) return;
  RUN[f.id] = "sum"; render(true);
  try { const sm = await summarize(f, f.tpl); f.sum = sm; RUN[f.id] = "check"; render(true); await verify(f); f.status = "ok"; }
  catch (e) { toast(e.message, 5000); }
  delete RUN[f.id]; f._plain = null; await saveFile(f); render(true);
}
function tplEdit(f) {
  const s = sheet(`<h3>Novo modelo</h3><div class="field"><label for="tn">Nome</label><input id="tn" placeholder="Ex.: Avaliação de prato"></div>
    <div class="field"><label for="tg">O que o resumo deve ter</label><textarea id="tg" placeholder="Ex.: Prato avaliado, o que estava bom, o que mudar, quem vai ajustar e até quando."></textarea></div><button class="primary" id="ok">Salvar e usar</button>`);
  s.querySelector("#ok").onclick = async () => {
    const name = s.querySelector("#tn").value.trim(), guide = s.querySelector("#tg").value.trim();
    if (!name || !guide) { toast("Preencha nome e descrição"); return; }
    CUSTOM_TPLS = CUSTOM_TPLS.filter(t => t.name !== name); CUSTOM_TPLS.push({name, guide}); await kv("tpls", CUSTOM_TPLS);
    close(); if (f) { f.tpl = name; await saveFile(f); f.tr ? regenSummary(f) : render(true); }
  };
}
function speakerSheet(f, sp) {
  const cur = spName(f, sp);
  const s = sheet(`<h3>Quem é “${esc(cur)}”?</h3><p class="sub">Vale para todas as falas desta pessoa nesta gravação.</p>${VOCAB.pessoas.map(p => `<button class="srow" data-n="${esc(p.w)}" aria-checked="${p.w === cur}">${esc(p.w)}<span class="r">${p.w === cur ? "✓" : esc(p.role || "")}</span></button>`).join("")}
    <div class="field"><label for="on">Outro nome</label><input id="on" placeholder="Nome"></div><button class="primary" id="ok">Salvar</button>`);
  const set = async n => { f.tr.speakers[sp] = n; await saveFile(f); close(); render(true); if (f.sum) toast("Para o resumo usar o nome, troque o modelo ou gere de novo", 3500); };
  s.querySelectorAll("[data-n]").forEach(b => b.onclick = () => set(b.dataset.n));
  s.querySelector("#ok").onclick = () => { const v = s.querySelector("#on").value.trim(); if (v) set(v.slice(0, 30)); };
}
function editLine(f, i) {
  const seg = f.tr.segs[i], before = plain(seg.text);
  const s = sheet(`<h3>Corrigir fala</h3><p class="sub">${esc(spName(f, seg.sp))} · ${fmt(seg.t)}</p><div class="field"><textarea id="tx" style="min-height:140px">${esc(before)}</textarea></div><button class="primary" id="ok">Salvar</button>`);
  s.querySelector("#ok").onclick = async () => {
    const after = clean(s.querySelector("#tx").value); if (!after || after === before) { close(); return; }
    seg.raw = after; seg.text = after; highlightForeign(seg); f._plain = null; await saveFile(f); close(); render(true);
    const a = before.split(" "), b = after.split(" "); let x = 0; while (x < a.length && x < b.length && a[x] === b[x]) x++;
    let y = 0; while (y < a.length - x && y < b.length - x && a[a.length - 1 - y] === b[b.length - 1 - y]) y++;
    const neu = b.slice(x, b.length - y).join(" ").replace(/[.,;:!?]+$/, ""), old = a.slice(x, a.length - y).join(" ").replace(/[.,;:!?]+$/, "");
    if (neu && neu.split(" ").length <= 4 && /\p{L}/u.test(neu) && !Object.values(VOCAB).flat().some(v => v.w.toLowerCase() === neu.toLowerCase()))
      setTimeout(() => addWord(neu, old, "Guardar no vocabulário?"), 250);
  };
}
function askSheet(f) {
  f.qa ||= [];
  const s = sheet(`<h3><span class="spark">✦</span> Perguntar</h3><p class="sub">Sobre: ${esc(f.title)}</p><div class="chat" id="chat">${chatHTML(f.qa, f)}</div>
    <div class="askin"><textarea id="aq" rows="1" placeholder="Ex.: Quem ficou responsável pelo quê?"></textarea><button id="as" aria-label="Enviar">↑</button></div>`);
  bindChat(s, f);
  s.querySelector("#as").onclick = async () => {
    const ta = s.querySelector("#aq"), q = ta.value.trim(); if (!q) return;
    if (!CFG.anKey) { toast("Coloque a chave do Claude em Eu › Chaves"); return; }
    ta.value = ""; const ch = s.querySelector("#chat");
    ch.insertAdjacentHTML("beforeend", `<div class="qq">${esc(q)}</div><div class="aa" id="pend"><div class="prog"><i></i></div></div>`); ch.lastElementChild.scrollIntoView({block: "end"});
    try { const r = await ask(q, [f], f.qa); f.qa.push({q, a: r.answer, refs: r.refs}); await saveFile(f); }
    catch (e) { f.qa.push({q, a: "Não consegui responder: " + e.message, refs: []}); }
    if (!document.body.contains(ch)) return;
    ch.innerHTML = chatHTML(f.qa, f); bindChat(s, f); ch.lastElementChild?.scrollIntoView({block: "end"});
  };
}
function chatHTML(qa, f) {
  return qa.map(x => `<div class="qq">${esc(x.q)}</div><div class="aa">${x.a.split(/\n+/).map(p => `<p>${italicTerms(esc(p))}</p>`).join("")}${refsHTML(x.refs, f)}</div>`).join("");
}
function refsHTML(refs, f) {
  const out = (refs || []).map(r => { const g = f || fileById(r.file); const seg = g?.tr?.segs[r.seg]; return seg ? `<button class="ts" data-f="${g.id}" data-i="${r.seg}">${f ? "" : esc(g.title.slice(0, 28)) + " "}${fmt(seg.t)}</button>` : ""; }).join(" ");
  return out ? `<div class="src">${out}</div>` : "";
}
function bindChat(s, f) {
  s.querySelectorAll(".ts").forEach(b => b.onclick = async () => {
    close(); const id = b.dataset.f;
    if (S.open !== id) await openFile(id);
    jump(+b.dataset.i);
  });
}

/* Vocabulário */
function vrow(it, kind, idx) {
  const lang = kind === "ja" ? "ja" : kind === "en" ? "en" : "pt", lbl = {ja: "JA", en: "EN", pt: kind === "pessoas" ? "NOME" : "LOCAL"}[lang];
  const sub = kind === "pessoas" ? it.role : it.mean;
  return `<button class="vitem" data-k="${kind}" data-i="${idx}"><span class="lang ${lang}">${lbl}</span><span><span class="nm">${esc(it.w)}${kind === "ja" && it.k ? `<small>${esc(it.k)}</small>` : ""}</span><div class="al">${esc(sub || "")}${it.was.length ? `${sub ? " · " : ""}não escrever <s>${it.was.map(esc).join("</s>, <s>")}</s>` : ""}</div></span><span class="cnt">${it.n ? it.n + (it.n > 1 ? " correções" : " correção") : ""} ›</span></button>`;
}
function vocabView() {
  const sec = (k, title, hint) => (S.vfilter === "tudo" || S.vfilter === k) ? `<div class="vsec"><h2>${title}</h2><span>${hint}</span></div><div class="vlist">${VOCAB[k].map((i, n) => vrow(i, k, n)).join("") || `<p class="note">Nada ainda.</p>`}</div>` : "";
  const sugg = SUGG.filter(x => !Object.values(VOCAB).flat().some(v => v.w.toLowerCase() === x.w.toLowerCase()));
  return `<div class="nb"><div class="t"><span class="fsw">Vale para todas as pastas</span><h1 class="big">Vocabulário</h1></div><button class="ib" id="vadd" aria-label="Adicionar termo">＋</button></div>
    <div class="vhero"><b>${vcount()} termos.</b> O motor de transcrição recebe esta lista antes de ouvir o áudio, e o Claude corrige depois só o que bater com ela. Palavras em inglês e japonês ficam no original.</div>
    <div class="chips">${[["tudo", "Tudo"], ["pessoas", "Pessoas"], ["ja", "Japonês"], ["en", "Inglês"], ["lugares", "Lugares e empresas"]].map(([k, n]) => `<button class="chip" data-vf="${k}" aria-pressed="${S.vfilter === k}">${n}</button>`).join("")}</div>
    ${sec("pessoas", "Pessoas", "nomes que sempre aparecem")}
    ${sec("ja", "Japonês", "em romaji, como se fala na cozinha")}
    ${sec("en", "Inglês e outros", "ficam no original, sem traduzir")}
    ${sec("lugares", "Lugares e empresas", "")}
    <div class="addrow">${sugg.length ? `<button id="sug"><span class="spark">✦</span> ${sugg.length} ${sugg.length > 1 ? "sugestões" : "sugestão"} das gravações</button>` : ""}<button id="imp">Colar uma lista</button></div>
    <div class="how"><h2>Como o vocabulário é usado</h2>
    <div class="step"><b class="n">1</b><span><b>Antes de transcrever:</b> a lista vai junto com o áudio. O motor passa a ouvir “Tadashi” em vez de “Tadá”.</span></div>
    <div class="step"><b class="n">2</b><span><b>Na revisão:</b> o Claude troca só palavras que batem com a lista e cada troca fica marcada em amarelo na transcrição.</span></div>
    <div class="step"><b class="n">3</b><span><b>Outros idiomas:</b> <i>shari</i>, <i>nori</i>, <i>take-out</i> e <i>prep</i> ficam no original. Nunca viram “chari” ou “teicaute”.</span></div>
    <div class="step"><b class="n">4</b><span><b>Aprende com você:</b> cada erro corrigido entra em “não escrever”, e quando você corrige uma fala o app pergunta se quer guardar a palavra.</span></div></div>`;
}
function bindVocab() {
  $$("[data-vf]").forEach(c => c.onclick = () => { S.vfilter = c.dataset.vf; render(true); });
  $$(".vitem").forEach(b => b.onclick = () => editWord(b.dataset.k, +b.dataset.i));
  $("#vadd").onclick = () => addWord("");
  const sg = $("#sug");
  if (sg) sg.onclick = () => {
    const list = SUGG.filter(x => !Object.values(VOCAB).flat().some(v => v.w.toLowerCase() === x.w.toLowerCase()));
    const s = sheet(`<h3>Sugestões</h3><p class="sub">Palavras que o Claude não reconheceu nas suas gravações. Toque para adicionar com a grafia certa.</p>${list.map(x => `<div class="srow"><button data-sw="${esc(x.w)}" style="flex:1;text-align:left"><span class="ic">?</span> ${esc(x.w)}</button><button class="r" data-dis="${esc(x.w)}" aria-label="Descartar">✕</button></div>`).join("")}`);
    s.querySelectorAll("[data-sw]").forEach(b => b.onclick = () => addWord(b.dataset.sw, b.dataset.sw));
    s.querySelectorAll("[data-dis]").forEach(b => b.onclick = async () => { SUGG = SUGG.filter(x => x.w !== b.dataset.dis); await kv("sugg", SUGG); b.closest(".srow").remove(); render(true); });
  };
  $("#imp").onclick = () => {
    const s = sheet(`<h3>Colar uma lista</h3><p class="sub">Uma palavra por linha. Se quiser, depois de “=” escreva como costuma sair errado.</p>
      <div class="field"><label for="lt">Tipo</label><select id="lt">${Object.entries(KINDS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div>
      <div class="field"><textarea id="ll" style="min-height:160px" placeholder="Tadashi = Tadá, Tadachi\nwasabi\ngari = gári"></textarea></div><button class="primary" id="ok">Adicionar</button>`);
    s.querySelector("#ok").onclick = async () => {
      const k = s.querySelector("#lt").value; let n = 0;
      for (const line of s.querySelector("#ll").value.split("\n")) {
        const [w, wr] = line.split("="); const word = clean(w || ""); if (!word) continue;
        if (Object.values(VOCAB).flat().some(v => v.w.toLowerCase() === word.toLowerCase())) continue;
        VOCAB[k].push({w: word, role: "", mean: "", k: "", was: (wr || "").split(",").map(clean).filter(Boolean), n: 0}); n++;
      }
      await saveVocab(); close(); render(true); toast(`${n} ${n === 1 ? "termo adicionado" : "termos adicionados"}`);
    };
  };
}
function editWord(k, i) {
  const it = VOCAB[k][i];
  const s = sheet(`<h3>${esc(it.w)}</h3><p class="sub">${KINDS[k]}</p>
    <div class="field"><label for="ew">Escrever sempre como</label><input id="ew" value="${esc(it.w)}"></div>
    ${k === "ja" ? `<div class="field"><label for="ek">Em japonês (opcional)</label><input id="ek" value="${esc(it.k || "")}"></div>` : ""}
    <div class="field"><label for="ex">Costuma sair errado como (separe por vírgula)</label><input id="ex" value="${esc(it.was.join(", "))}"></div>
    <div class="field"><label for="er">${k === "pessoas" ? "Função ou apelido" : "Significado"}</label><input id="er" value="${esc(k === "pessoas" ? it.role : it.mean)}"></div>
    <div class="field"><label>Corrigido nas suas gravações</label><span style="font-size:14px">${it.n || 0} ${it.n === 1 ? "vez" : "vezes"}</span></div>
    <button class="primary" id="sv">Salvar</button><button class="srow danger" id="rm" style="justify-content:center;margin-top:8px">Remover do vocabulário</button>`);
  s.querySelector("#sv").onclick = async () => {
    it.w = clean(s.querySelector("#ew").value) || it.w;
    it.was = s.querySelector("#ex").value.split(",").map(clean).filter(Boolean);
    const r = s.querySelector("#er").value.trim(); if (k === "pessoas") it.role = r; else it.mean = r;
    const kk = s.querySelector("#ek"); if (kk) it.k = kk.value.trim();
    await saveVocab(); close(); render(true); toast("Salvo. Vale para as próximas gravações");
  };
  s.querySelector("#rm").onclick = async () => { VOCAB[k].splice(i, 1); await saveVocab(); close(); render(true); };
}
function addWord(w, heard, title) {
  w = (w || "").trim();
  const s = sheet(`<h3>${esc(title || "Adicionar ao vocabulário")}</h3><p class="sub">Vale para todas as gravações a partir de agora.</p>
    <div class="field"><label for="aw">Escrito do jeito certo</label><input id="aw" value="${esc(w)}" placeholder="Ex.: Tadashi, shari, take-out"></div>
    <div class="field"><label for="at">Tipo</label><select id="at">${Object.entries(KINDS).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div>
    <div class="field"><label for="ax">Costuma sair errado como (opcional)</label><input id="ax" value="${esc(heard && heard !== w ? heard : "")}" placeholder="Ex.: Tadá"></div>
    <div class="field"><label for="am">Função, apelido ou significado (opcional)</label><input id="am"></div>
    <button class="primary" id="ad">Adicionar</button>`);
  s.querySelector("#ad").onclick = async () => {
    const v = clean(s.querySelector("#aw").value); if (!v) { toast("Escreva a palavra"); return; }
    const k = s.querySelector("#at").value, x = clean(s.querySelector("#ax").value), m = s.querySelector("#am").value.trim();
    if (Object.values(VOCAB).flat().some(i => i.w.toLowerCase() === v.toLowerCase())) { toast("Já está no vocabulário"); return; }
    VOCAB[k].push({w: v, role: k === "pessoas" ? m : "", mean: k === "pessoas" ? "" : m, k: "", was: x && x !== v ? [x] : [], n: 0});
    if (heard) { SUGG = SUGG.filter(z => z.w.toLowerCase() !== heard.toLowerCase()); await kv("sugg", SUGG); }
    await saveVocab(); close(); render(true); toast(`“${v}” adicionado ao vocabulário`);
  };
}

/* Perguntar (todas as gravações) */
function askView() {
  const done = files.filter(f => f.tr && !f.trashed);
  return `<div class="nb"><div class="t"><span class="fsw">${done.length} ${done.length === 1 ? "gravação transcrita" : "gravações transcritas"}</span><h1 class="big">Perguntar</h1></div>${GQA.length ? `<button class="ib" id="clr" aria-label="Limpar conversa">⌫</button>` : ""}</div>
    <div class="body" style="padding-bottom:30px">${GQA.length ? "" : `<p style="color:var(--sub);margin-top:0">Pergunte sobre qualquer gravação. A resposta mostra de onde saiu, e tocar no horário abre o trecho.</p>
    <div class="chips" style="padding:0 0 8px;flex-wrap:wrap">${["O que o Tadashi decidiu nesta semana?", "Quais problemas com fornecedores apareceram?", "Monte um plano de treino para o Lucas Ryu"].map(x => `<button class="chip" data-ex="${esc(x)}" style="white-space:normal;text-align:left">${esc(x)}</button>`).join("")}</div>`}
    <div class="chat" id="chat">${chatHTML(GQA)}</div>
    <div class="askin"><textarea id="aq" rows="1" placeholder="✦ Pergunte algo"></textarea><button id="as" aria-label="Enviar">↑</button></div></div>`;
}
function bindAsk() {
  const ta = $("#aq");
  $$("[data-ex]").forEach(b => b.onclick = () => { ta.value = b.dataset.ex; ta.focus(); });
  const c = $("#clr"); if (c) c.onclick = async () => { GQA = []; await kv("gqa", GQA); render(); };
  bindChat(document, null);
  $("#as").onclick = async () => {
    const q = ta.value.trim(); if (!q) return;
    if (!CFG.anKey) { toast("Coloque a chave do Claude em Eu › Chaves"); return; }
    const scope = files.filter(f => f.tr && !f.trashed);
    if (!scope.length) { toast("Ainda não há gravações transcritas"); return; }
    ta.value = ""; const ch = $("#chat");
    ch.insertAdjacentHTML("beforeend", `<div class="qq">${esc(q)}</div><div class="aa"><div class="prog"><i></i></div></div>`);
    ch.lastElementChild.scrollIntoView({block: "end"});
    try { const r = await ask(q, scope, GQA); GQA.push({q, a: r.answer, refs: r.refs}); }
    catch (e) { GQA.push({q, a: "Não consegui responder: " + e.message, refs: []}); }
    GQA = GQA.slice(-30); await kv("gqa", GQA);
    if (S.tab === "ask" && !S.open) { render(true); const sc = $("#screen"); sc.scrollTop = sc.scrollHeight; }
  };
}

/* Eu */
function meView() {
  const m = USAGE[monthKey()] || {}, tot = Object.values(USAGE).reduce((a, x) => a + (x.sttUsd || 0) + (x.claudeUsd || 0), 0);
  const month = cap(new Date().toLocaleDateString("pt-BR", {month: "long"}));
  return `<div class="nb"><div class="t"><h1 class="big">Eu</h1></div></div>
  <div class="mh">Chaves das APIs</div><div class="mcard">
    <div class="field" style="border:0"><label for="kel">ElevenLabs (transcrição) ${CFG.elKey ? `<span class="keyok">✓ salva</span>` : ""}</label><input id="kel" type="password" autocomplete="off" placeholder="Cole a chave aqui" value="${esc(CFG.elKey)}"></div>
    <div class="field" style="border:0"><label for="kan">Claude (resumos e perguntas) ${CFG.anKey ? `<span class="keyok">✓ salva</span>` : ""}</label><input id="kan" type="password" autocomplete="off" placeholder="sk-ant-…" value="${esc(CFG.anKey)}"></div>
    <div class="row2" style="padding:4px 0 12px"><button class="sbtn" id="tk">Testar a chave do Claude</button><button class="sbtn" id="hk">Como conseguir</button></div></div>
  <p class="note" style="padding-top:6px">As chaves ficam só neste aparelho e vão direto para o ElevenLabs e para a Anthropic.</p>
  <div class="mh">Transcrição e resumo</div><div class="mcard">
    <div class="opt"><span>Modelo do Claude</span><select id="cm" style="font:inherit;color:var(--ink);background:var(--fill);border:0">${Object.entries(MODELS).map(([k, v]) => `<option value="${k}" ${k === CFG.model ? "selected" : ""}>${v.label} (${v.hint})</option>`).join("")}</select></div>
    <div class="opt"><span>Idioma principal</span><select id="cl" style="font:inherit;color:var(--ink);background:var(--fill);border:0"><option value="pt" ${CFG.lang === "pt" ? "selected" : ""}>Português</option><option value="auto" ${CFG.lang === "auto" ? "selected" : ""}>Detectar sozinho</option></select></div>
    <div class="opt"><span>Identificar quem fala</span>${tog(CFG.speakers, "csp", "Identificar quem fala")}</div>
    <div class="opt"><span>Gerar sozinho ao importar</span>${tog(CFG.autogen, "cag", "Gerar sozinho ao importar")}</div>
    <div class="opt"><span>Vocabulário</span><span class="v">${vcount()} termos</span></div></div>
  <div class="mh">Sobre você</div><div class="mcard"><div class="field" style="border:0"><textarea id="ctx">${esc(CFG.context)}</textarea><span class="hint">O Claude lê isto antes de cada resumo. Diga quem você é e do que falam as gravações.</span></div></div>
  <div class="mh">Uso em ${month}</div><div class="mcard">
    <div class="opt"><span>Áudio transcrito</span><span class="v">${Math.floor((m.sttSec || 0) / 3600)} h ${Math.round((m.sttSec || 0) % 3600 / 60)} min</span></div>
    <div class="opt"><span>Transcrição</span><span class="v">≈ ${usd(m.sttUsd)}</span></div>
    <div class="opt"><span>Claude</span><span class="v">≈ ${usd(m.claudeUsd)}</span></div>
    <div class="opt"><span>Total desde o início</span><span class="v">≈ ${usd(tot)}</span></div>
    <div class="opt"><span>Limite de minutos</span><span class="v">Nenhum</span></div></div>
  <p class="note" style="padding-top:6px">Valores estimados pelo app. A cobrança real aparece no painel de cada serviço.</p>
  <div class="mh">Onde fica salvo</div><div class="mcard">
    <div class="opt"><span>Áudios e textos</span><span class="v">Neste iPhone, dentro do Escuta</span></div>
    <div class="opt"><span>Espaço usado</span><span class="v" id="sto">…</span></div>
    <div class="row2" style="padding:10px 0 12px"><button class="sbtn" id="bk">Salvar backup</button><button class="sbtn" id="rs">Restaurar</button></div></div>
  <p class="note" style="padding-top:6px">O backup guarda textos, pastas e vocabulário (sem os áudios). Salve em Arquivos ou no iCloud Drive. Para guardar um áudio, abra o arquivo › ⋯ › Salvar o áudio em Arquivos.</p>
  <div class="mh">De onde vêm as gravações</div><div class="mcard"><button class="srow" id="hp"><span class="ic">?</span>Como trazer do app da Plaud<span class="r">›</span></button></div>
  <p class="note">Escuta · versão 1.0</p>`;
}
function bindMe() {
  const save = async () => { await saveCfg(); };
  $("#kel").onchange = e => { CFG.elKey = e.target.value.trim(); save().then(() => render(true)); };
  $("#kan").onchange = e => { CFG.anKey = e.target.value.trim(); save().then(() => render(true)); };
  $("#cm").onchange = e => { CFG.model = e.target.value; save(); };
  $("#cl").onchange = e => { CFG.lang = e.target.value; save(); };
  $("#ctx").onchange = e => { CFG.context = e.target.value.trim(); save(); toast("Salvo"); };
  $("#csp").onclick = e => { CFG.speakers = !CFG.speakers; e.target.setAttribute("aria-checked", String(CFG.speakers)); save(); };
  $("#cag").onclick = e => { CFG.autogen = !CFG.autogen; e.target.setAttribute("aria-checked", String(CFG.autogen)); save(); };
  $("#tk").onclick = async () => {
    CFG.anKey = $("#kan").value.trim(); await save();
    if (!CFG.anKey) { toast("Cole a chave primeiro"); return; }
    toast("Testando…");
    try { await claude({system: "Responda só: ok", content: "Teste de conexão.", effort: "low", max: 2000}); toast("Chave do Claude funcionando ✓"); }
    catch (e) { toast(e.message, 5000); }
  };
  $("#hk").onclick = keysHelp;
  $("#hp").onclick = plaudHelp;
  $("#bk").onclick = backup;
  $("#rs").onclick = () => $("#restore").click();
  navigator.storage?.estimate?.().then(e => { const el = $("#sto"); if (el) el.textContent = (e.usage / 1048576).toFixed(0) + " MB"; }).catch(() => {});
}
function keysHelp() {
  sheet(`<h3>Como conseguir as chaves</h3>
    <div class="how" style="margin:8px 0">
    <div class="step"><b class="n">1</b><span><b>ElevenLabs:</b> crie a conta em elevenlabs.io, vá em Developers › API Keys, crie uma chave com permissão de Speech to Text e cole aqui. Cada hora de áudio custa cerca de US$ 0,26.</span></div>
    <div class="step"><b class="n">2</b><span><b>Claude:</b> entre em console.anthropic.com, adicione créditos em Billing (US$ 5 já dá para dezenas de horas) e crie a chave em API Keys. Cole aqui.</span></div>
    <div class="step"><b class="n">3</b><span>Toque em “Testar a chave do Claude”. A do ElevenLabs é testada na primeira transcrição.</span></div></div>
    <p class="sub">As chaves ficam só neste iPhone. Se trocar de aparelho, cole de novo.</p>`);
}
function plaudHelp() {
  sheet(`<h3>Trazer do app da Plaud</h3>
    <div class="how" style="margin:8px 0">
    <div class="step"><b class="n">1</b><span>No app da Plaud, abra a gravação e use a opção de exportar ou compartilhar o <b>áudio</b>.</span></div>
    <div class="step"><b class="n">2</b><span>Escolha <b>Salvar em Arquivos</b> e guarde numa pasta, por exemplo iCloud Drive › Plaud.</span></div>
    <div class="step"><b class="n">3</b><span>Aqui no Escuta, toque no <b>+</b> › Importar arquivo de áudio e escolha o arquivo. Pode escolher vários de uma vez.</span></div></div>
    <p class="sub">Se você estiver dentro de uma pasta, os áudios importados já entram nela.</p>`);
}

/* Importar, gravar, exportar, backup */
function probeDur(blob) {
  return new Promise(ok => {
    const a = document.createElement("audio"), u = URL.createObjectURL(blob); let done = false;
    const fin = v => { if (done) return; done = true; URL.revokeObjectURL(u); ok(isFinite(v) && v > 0 ? v : 0); };
    a.preload = "metadata"; a.onloadedmetadata = () => fin(a.duration); a.onerror = () => fin(0); setTimeout(() => fin(0), 5000); a.src = u;
  });
}
async function addFile(blob, name, created) {
  const id = uid(), folder = FOLDERS.some(x => x.name === S.folder) ? S.folder : null;
  const f = {id, title: name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").trim() || "Gravação " + dmy(created) + " " + hm(created), autoTitle: true,
    created, dur: 0, folder, status: "new", hasAudio: true, fname: name, mime: blob.type, size: blob.size};
  await DB.put("audio", blob, id);
  f.dur = await probeDur(blob);
  files.push(f); files.sort((a, b) => b.created - a.created);
  await saveFile(f);
  return f;
}
async function importFiles(list) {
  if (!list.length) return;
  navigator.storage?.persist?.().catch(() => {});
  toast(`Importando ${list.length}…`);
  const added = [];
  for (const file of list) { try { added.push(await addFile(file, file.name, file.lastModified || Date.now())); } catch (e) { toast("Falhou: " + file.name); } }
  S.tab = "files"; S.open = null; render();
  toast(`${added.length} ${added.length === 1 ? "gravação importada" : "gravações importadas"}`);
  if (CFG.autogen && CFG.elKey && CFG.anKey) runQueue(added);
}
function recorder() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Este navegador não grava áudio"); return; }
  const s = sheet(`<h3>Gravar pelo iPhone</h3><div class="rtime" id="rt">00:00</div><button class="recbig" id="rb" aria-label="Começar a gravar">Gravar</button><p class="sub" style="text-align:center">Deixe o app aberto e a tela ligada enquanto grava.</p>`);
  const rb = s.querySelector("#rb"); let mr = null, chunks = [], t0 = 0, timer, stream, wl;
  rb.onclick = async () => {
    if (!mr) {
      try { stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: true}}); }
      catch { toast("Permita o uso do microfone para gravar"); return; }
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(m => MediaRecorder.isTypeSupported(m)) || "";
      mr = new MediaRecorder(stream, mime ? {mimeType: mime} : {});
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = async () => {
        const type = mr.mimeType || mime || "audio/mp4", blob = new Blob(chunks, {type}), ext = type.includes("webm") ? "webm" : "m4a";
        const f = await addFile(blob, `Gravação ${dmy(t0).slice(0, 5)} ${hm(t0)}.${ext}`, t0);
        f.title = `Gravação ${dmy(t0).slice(0, 5)} ${hm(t0)}`; await saveFile(f);
        close(); S.tab = "files"; render(); toast("Gravação salva");
        if (CFG.autogen && CFG.elKey && CFG.anKey) generate(f);
      };
      mr.start(1000); t0 = Date.now(); s.dataset.lock = "1";
      timer = setInterval(() => { const el = s.querySelector("#rt"); if (el) el.textContent = fmt((Date.now() - t0) / 1000); }, 500);
      rb.classList.add("on"); rb.textContent = ""; rb.setAttribute("aria-label", "Parar e salvar");
      try { wl = await navigator.wakeLock?.request("screen"); } catch {}
    } else {
      clearInterval(timer); rb.disabled = true; mr.stop(); stream.getTracks().forEach(t => t.stop()); wl?.release?.().catch(() => {});
    }
  };
}
async function shareOrDownload(file) {
  if (navigator.canShare?.({files: [file]})) { try { await navigator.share({files: [file]}); return; } catch (e) { if (e.name === "AbortError") return; } }
  const a = document.createElement("a"), u = URL.createObjectURL(file); a.href = u; a.download = file.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 10000);
}
const safeName = s => s.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80);
function exportText(f) {
  let t = `# ${f.title}\n${dmy(f.created)} ${hm(f.created)} · ${fmt(f.dur)}${f.folder ? " · " + f.folder : ""}\n\n`;
  if (f.sum) {
    t += `## Resumo (${f.sum.tpl})\n\n`;
    for (const s of f.sum.sections) {
      t += `### ${s.heading}\n`;
      s.items.forEach((it, n) => { const ts = it.refs.map(r => f.tr.segs[r] ? fmt(f.tr.segs[r].t) : "").filter(Boolean).join(", ");
        t += (s.style === "paragraph" ? "" : s.style === "numbered" ? `${n + 1}. ` : "- ") + it.text + (ts ? ` [${ts}]` : "") + (it.unsure ? " (a confirmar)" : "") + "\n"; });
      t += "\n";
    }
  }
  t += `## Transcrição\n\n` + f.tr.segs.map(s => `[${fmt(s.t)}] ${spName(f, s.sp)}: ${plain(s.text)}`).join("\n\n") + "\n";
  shareOrDownload(new File([t], safeName(f.title) + ".txt", {type: "text/plain"}));
}
async function exportAudio(f) {
  const b = await DB.get("audio", f.id); if (!b) { toast("Áudio não encontrado"); return; }
  const ext = (f.fname || "").match(/\.[a-z0-9]{2,5}$/i)?.[0] || (b.type.includes("webm") ? ".webm" : ".m4a");
  shareOrDownload(new File([b], safeName(f.title) + ext, {type: b.type || "audio/mp4"}));
}
async function backup() {
  const data = {app: "escuta", v: 1, at: Date.now(), vocab: VOCAB, folders: FOLDERS, tpls: CUSTOM_TPLS, usage: USAGE, cfg: {...CFG, elKey: "", anKey: ""},
    files: files.map(f => ({...strip(f), hasAudio: false}))};
  shareOrDownload(new File([JSON.stringify(data)], `escuta-backup-${new Date().toISOString().slice(0, 10)}.json`, {type: "application/json"}));
}
async function restore(file) {
  try {
    const d = JSON.parse(await file.text()); if (d.app !== "escuta") throw new Error();
    VOCAB = d.vocab || VOCAB; FOLDERS = d.folders || FOLDERS; CUSTOM_TPLS = d.tpls || CUSTOM_TPLS;
    CFG = {...CFG, ...d.cfg, elKey: CFG.elKey, anKey: CFG.anKey};
    await saveVocab(); await saveFolders(); await kv("tpls", CUSTOM_TPLS); await saveCfg();
    let n = 0;
    for (const f of d.files || []) {
      const ex = fileById(f.id);
      if (ex) { if (!ex.tr && f.tr) { Object.assign(ex, {...f, hasAudio: ex.hasAudio}); await saveFile(ex); n++; } continue; }
      files.push(f); await saveFile(f); n++;
    }
    files.sort((a, b) => b.created - a.created); render(); toast(`Backup restaurado: ${n} arquivos`);
  } catch { toast("Este arquivo não é um backup do Escuta"); }
}

/* ---------- início ---------- */
$$("#tb [data-tab]").forEach(b => b.onclick = () => {
  const t = b.dataset.tab;
  if (t === "rec") {
    const s = sheet(`<h3>Adicionar gravação</h3>
      <button class="srow" id="ri"><span class="ic">⇪</span>Importar arquivo de áudio<span class="r">Arquivos, iCloud</span></button>
      <button class="srow" id="rr"><span class="ic" style="color:#e5352b">●</span>Gravar pelo iPhone</button>
      <button class="srow" id="rp"><span class="ic">?</span>Como trazer do app da Plaud</button>`);
    s.querySelector("#ri").onclick = () => { close(); $("#picker").click(); };
    s.querySelector("#rr").onclick = recorder;
    s.querySelector("#rp").onclick = plaudHelp;
    return;
  }
  S.tab = t; S.open = null; S.sel = null; $(".selbar")?.remove(); render();
});
$("#picker").onchange = e => { const l = [...e.target.files]; e.target.value = ""; importFiles(l); };
$("#restore").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) restore(f); };
const au = $("#audio");
["timeupdate", "play", "pause", "ended", "loadedmetadata"].forEach(ev => au.addEventListener(ev, syncPlayer));
au.addEventListener("loadedmetadata", async () => { const f = audioFor && fileById(audioFor); if (f && !f.dur && isFinite(au.duration)) { f.dur = au.duration; await saveFile(f); } });
window.addEventListener("beforeunload", e => { if (Object.keys(RUN).length) { e.preventDefault(); e.returnValue = ""; } });

load().then(() => render()).catch(e => { $("#screen").innerHTML = `<div class="empty"><b>Não consegui abrir o armazenamento</b><span>${esc(e.message || e)}</span></div>`; });
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
