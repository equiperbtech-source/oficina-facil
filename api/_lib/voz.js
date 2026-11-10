/* "Preencher OS por voz": chamada à IA (Google Gemini com o áudio, ou Claude Haiku com o texto transcrito) e limpeza da resposta.
   - O áudio vai direto para o Gemini (inline, em base64) e não é guardado em lugar nenhum.
   - Saída estruturada em JSON (schema abaixo). A lista de serviços e peças da oficina vai no prompt,
     para a IA escolher entre eles em vez de inventar nomes.
   - Chave: GEMINI_API_KEY. Modelo: GEMINI_MODEL (padrão: o Gemini Flash mais recente, pelo apelido do Google). */
export const MODELO_PADRAO = 'gemini-flash-latest';

export const INSTRUCOES = "Você extrai dados de ordens de serviço de oficina de moto a partir de áudios em português do Brasil, com gírias de mecânico. Preencha somente o que foi dito claramente. Se não tiver certeza de um campo, deixe null e coloque o nome do campo em campos_incertos. Nunca invente dados. Placas podem estar no padrão antigo (ABC1234) ou Mercosul (ABC1D23); números falados devem virar dígitos ('trinta e dois mil' = 32000). Associe serviços e peças à lista cadastrada sempre que possível.";

const S = (extra = {}) => ({ type: 'STRING', nullable: true, ...extra });
const N = (tipo = 'NUMBER') => ({ type: tipo, nullable: true });
export const SCHEMA = {
  type: 'OBJECT',
  properties: {
    placa: S(), modelo_moto: S(), ano: N('INTEGER'), km: N('INTEGER'), nome_cliente: S(), telefone_cliente: S(),
    servicos: { type: 'ARRAY', items: { type: 'OBJECT', properties: { nome: { type: 'STRING' }, id_cadastro: S() }, required: ['nome', 'id_cadastro'] } },
    pecas: { type: 'ARRAY', items: { type: 'OBJECT', properties: { nome: { type: 'STRING' }, quantidade: { type: 'NUMBER' }, id_cadastro: S() }, required: ['nome', 'quantidade', 'id_cadastro'] } },
    defeito_relatado: S(), observacoes: S(),
    campos_incertos: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['placa', 'modelo_moto', 'ano', 'km', 'nome_cliente', 'telefone_cliente', 'servicos', 'pecas', 'defeito_relatado', 'observacoes', 'campos_incertos'],
  propertyOrdering: ['placa', 'modelo_moto', 'ano', 'km', 'nome_cliente', 'telefone_cliente', 'servicos', 'pecas', 'defeito_relatado', 'observacoes', 'campos_incertos'],
};
const CAMPOS = ['placa', 'modelo_moto', 'ano', 'km', 'nome_cliente', 'telefone_cliente', 'defeito_relatado', 'observacoes'];

// texto com a lista cadastrada (id | nome), limitada para o prompt não ficar enorme
export function textoCatalogo(cat = {}) {
  const linha = (x, comCodigo) => `${x.id} | ${String(x.nome || '').slice(0, 80)}${comCodigo && x.codigo ? ' | código ' + String(x.codigo).slice(0, 30) : ''}`;
  const sv = (cat.servicos || []).filter(x => x && x.id && x.nome).slice(0, 300).map(x => linha(x));
  const pc = (cat.pecas || []).filter(x => x && x.id && x.nome).slice(0, 600).map(x => linha(x, true));
  return `Serviços cadastrados na oficina (id | nome):\n${sv.join('\n') || '(nenhum)'}\n\nPeças cadastradas na oficina (id | nome | código):\n${pc.join('\n') || '(nenhuma)'}\n\n`
    + 'Use em id_cadastro o id exato da lista quando o serviço ou a peça falada for um destes; senão, id_cadastro = null e o nome como foi falado.';
}

// Chama o Gemini. Devolve o objeto do schema (ainda sem limpeza). Erros: ErroIA com motivo curto.
export class ErroIA extends Error { constructor(motivo, detalhe) { super(motivo); this.motivo = motivo; this.detalhe = detalhe; } }
export async function chamarGemini({ audioB64, mime, texto, catalogo, chave, modelo, fetchImpl = fetch }) {
  if (!chave) throw new ErroIA('sem_chave');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo || MODELO_PADRAO)}:generateContent`;
  const corpo = {
    // com áudio (o normal no Gemini) ou com o texto já transcrito pelo navegador
    systemInstruction: { parts: [{ text: texto ? `${INSTRUCOES}\n\n${NOTA_TEXTO}` : INSTRUCOES }] },
    contents: [{ role: 'user', parts: [{ text: textoCatalogo(catalogo) }, texto ? { text: `Transcrição da fala do mecânico:\n"""\n${String(texto).slice(0, 4000)}\n"""` } : { inlineData: { mimeType: mime, data: audioB64 } }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA },
  };
  let r;
  try { r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(corpo) }); }
  catch (e) { throw new ErroIA('rede', e && e.message); }
  const txt = await r.text();
  if (!r.ok) throw new ErroIA(r.status === 429 ? 'limite_ia' : 'falha_ia', `${r.status} ${txt.slice(0, 300)}`);
  let j; try { j = JSON.parse(txt); } catch { throw new ErroIA('falha_ia', 'resposta não é JSON'); }
  const parte = j?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string');
  if (!parte) throw new ErroIA('sem_resposta', JSON.stringify(j?.promptFeedback || j?.candidates?.[0]?.finishReason || '').slice(0, 200));
  try { return JSON.parse(parte.text); } catch { throw new ErroIA('falha_ia', 'JSON inválido do modelo'); }
}

// Limpa a resposta: placa normalizada, números como número, ids que existem de verdade, campos vazios em campos_incertos
export function limpar(bruto, catalogo = {}) {
  const d = bruto && typeof bruto === 'object' ? bruto : {};
  const txt = v => { const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); return s && !/^(null|nenhum|nenhuma|n\/a|-)$/i.test(s) ? s : null; };
  const num = v => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  const ids = (l, tipo) => new Set((catalogo[tipo] || []).map(x => String(x.id)));
  const idsSv = ids(null, 'servicos'), idsPc = ids(null, 'pecas');
  const placa = txt(d.placa) ? String(d.placa).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) || null : null;
  let ano = num(d.ano); if (ano && (ano < 1950 || ano > new Date().getFullYear() + 1)) ano = null;
  const fone = txt(d.telefone_cliente) ? String(d.telefone_cliente).replace(/\D/g, '') : '';
  const out = {
    placa, modelo_moto: txt(d.modelo_moto), ano, km: num(d.km), nome_cliente: txt(d.nome_cliente),
    telefone_cliente: fone.length >= 8 ? fone : null,
    servicos: (Array.isArray(d.servicos) ? d.servicos : []).map(s => ({ nome: txt(s?.nome), id_cadastro: idsSv.has(String(s?.id_cadastro)) ? String(s.id_cadastro) : null })).filter(s => s.nome || s.id_cadastro).slice(0, 30),
    pecas: (Array.isArray(d.pecas) ? d.pecas : []).map(p => ({ nome: txt(p?.nome), quantidade: Number(p?.quantidade) > 0 ? Math.round(Number(p.quantidade) * 1000) / 1000 : 1, id_cadastro: idsPc.has(String(p?.id_cadastro)) ? String(p.id_cadastro) : null })).filter(p => p.nome || p.id_cadastro).slice(0, 50),
    defeito_relatado: txt(d.defeito_relatado), observacoes: txt(d.observacoes),
  };
  const inc = new Set((Array.isArray(d.campos_incertos) ? d.campos_incertos : []).map(String).filter(c => CAMPOS.includes(c) || c === 'servicos' || c === 'pecas'));
  for (const c of CAMPOS) if (out[c] == null && c !== 'observacoes') inc.add(c);
  out.campos_incertos = [...inc];
  out.vazio = !out.placa && !out.modelo_moto && !out.nome_cliente && !out.defeito_relatado && !out.servicos.length && !out.pecas.length && !out.km;
  return out;
}

/* ---------- Claude (Anthropic) ----------
   O Claude não recebe áudio: o navegador transcreve a fala (reconhecimento de voz do próprio celular) e o
   servidor manda só o TEXTO. Chave: ANTHROPIC_API_KEY. Modelo: VOZ_CLAUDE_MODEL (padrão: Claude Haiku 5.5). */
export const MODELO_CLAUDE_PADRAO = 'claude-haiku-5-5';
export const NOTA_TEXTO = 'O pedido traz a TRANSCRIÇÃO automática da fala do mecânico (o reconhecimento de voz do celular), não o áudio. '
  + "A transcrição pode ter erros de reconhecimento: letras e números da placa podem vir separados ou por extenso ('a b c um d dois três' = ABC1D23). "
  + 'Responda somente com o JSON pedido.';
const nulo = tipo => ({ anyOf: [{ type: tipo }, { type: 'null' }] });
// o mesmo schema do Gemini, em JSON Schema (Claude: todo objeto com additionalProperties false e tudo em required)
export const SCHEMA_JSON = {
  type: 'object',
  properties: {
    placa: nulo('string'), modelo_moto: nulo('string'), ano: nulo('integer'), km: nulo('integer'), nome_cliente: nulo('string'), telefone_cliente: nulo('string'),
    servicos: { type: 'array', items: { type: 'object', properties: { nome: { type: 'string' }, id_cadastro: nulo('string') }, required: ['nome', 'id_cadastro'], additionalProperties: false } },
    pecas: { type: 'array', items: { type: 'object', properties: { nome: { type: 'string' }, quantidade: { type: 'number' }, id_cadastro: nulo('string') }, required: ['nome', 'quantidade', 'id_cadastro'], additionalProperties: false } },
    defeito_relatado: nulo('string'), observacoes: nulo('string'),
    campos_incertos: { type: 'array', items: { type: 'string' } },
  },
  required: SCHEMA.required,
  additionalProperties: false,
};

export async function chamarClaude({ texto, catalogo, chave, modelo, fetchImpl }) {
  if (!chave) throw new ErroIA('sem_chave');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: chave, maxRetries: 1, timeout: 50_000, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  let r;
  try {
    r = await client.messages.create({
      model: modelo || MODELO_CLAUDE_PADRAO,
      max_tokens: 8000,
      system: `${INSTRUCOES}\n\n${NOTA_TEXTO}`,
      messages: [{ role: 'user', content: `${textoCatalogo(catalogo)}\n\nTranscrição da fala do mecânico:\n"""\n${String(texto).slice(0, 4000)}\n"""` }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA_JSON } },
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ErroIA('limite_ia', e.message);
    if (e instanceof Anthropic.APIConnectionError) throw new ErroIA('rede', e.message);   // inclui o tempo esgotado
    if (e instanceof Anthropic.APIError) throw new ErroIA('falha_ia', `${e.status} ${String(e.message).slice(0, 300)}`);
    throw new ErroIA('falha_ia', e && e.message);
  }
  if (r.stop_reason === 'refusal') throw new ErroIA('sem_resposta', JSON.stringify(r.stop_details || '').slice(0, 200));
  if (r.stop_reason === 'max_tokens') throw new ErroIA('falha_ia', 'resposta cortada (max_tokens)');
  const parte = r.content.find(b => b.type === 'text');
  if (!parte) throw new ErroIA('sem_resposta', r.stop_reason);
  try { return JSON.parse(parte.text); } catch { throw new ErroIA('falha_ia', 'JSON inválido do modelo'); }
}
