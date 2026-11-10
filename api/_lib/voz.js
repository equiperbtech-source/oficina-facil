/* "Preencher OS por voz": chamada ao Google Gemini e limpeza da resposta.
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
export async function chamarGemini({ audioB64, mime, catalogo, chave, modelo, fetchImpl = fetch }) {
  if (!chave) throw new ErroIA('sem_chave');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo || MODELO_PADRAO)}:generateContent`;
  const corpo = {
    systemInstruction: { parts: [{ text: INSTRUCOES }] },
    contents: [{ role: 'user', parts: [{ text: textoCatalogo(catalogo) }, { inlineData: { mimeType: mime, data: audioB64 } }] }],
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
