/* Banco de dados local (localStorage) */
// Textos padrão da oficina em outros idiomas (termos de garantia e de entrada)
const PADROES_IDIOMA = {
  es: {
    termosGarantia: 'La garantía cubre únicamente el servicio realizado y los repuestos cambiados descritos en esta orden, por el plazo o el kilometraje indicados (lo que ocurra primero). No cubre: desgaste natural, mal uso, accidentes, falta de mantenimiento, uso de combustible o lubricante inadecuados, ni intervenciones de terceros en las piezas reparadas.',
    termosGarantiaProduto: 'Repuestos y accesorios: garantía contra defectos de fabricación por el plazo indicado. No cubre instalación hecha por terceros, mal uso, accidentes ni desgaste natural. Guarda este recibo: es necesario para hacer válida la garantía.',
    termosEntrada: 'Los vehículos no retirados en un plazo de 90 días después del aviso de finalización se considerarán abandonados. El taller no se responsabiliza por objetos personales dejados en el vehículo que no estén anotados en esta orden.',
  },
};
const DB_KEY = 'oficina_db_v1';

const OS_STATUS = {
  analise:   { label: 'Em análise',            icon: 'alertCircle', color: '#1D4ED8', pill: 'blue' },
  aprovacao: { label: 'Aguardando aprovação',  icon: 'clock',       color: '#A16207', pill: 'orange' },
  peca:      { label: 'Aguardando peça',       icon: 'box',         color: '#C2410C', pill: 'orange' },
  servico:   { label: 'Em serviço',            icon: 'wrench',      color: '#7C3AED', pill: 'purple' },
  concluido: { label: 'Pronto para retirada',  icon: 'checkCircle', color: '#137333', pill: 'green' },
  pago:      { label: 'Pago',             icon: 'dollar',      color: '#0F766E', pill: 'gold' },
  interrompido: { label: 'Interrompido',  icon: 'xCircle',     color: '#B91C1C', pill: 'red' },
};
const OS_ATIVOS = ['analise', 'aprovacao', 'peca', 'servico', 'concluido'];
/* Etapas do pátio: a oficina cria etapas novas (ex.: "Aguardando cliente"), renomeia e tira as que não usa.
   O card "Pago" fica fixo no fim, fora do quadro de etapas ativas.
   Fica em Store.s.etapas = { extras: [{ id: 'e_...', label, cor, removida }], ocultas: ['peca'], ordem: ['analise', ...] }.
   "Em análise" (entrada da OS) e "Pronto para retirada" não saem: o resto do sistema depende deles.
   Renomear uma etapa padrão: Store.s.etapas.nomes = { peca: 'Esperando peça' }.
   Card removido continua com o nome guardado, para o histórico das OS antigas. */
const ETAPAS_BASE = ['analise', 'aprovacao', 'peca', 'servico', 'concluido'];
const ETAPAS_FIXAS = ['analise', 'concluido'];
const Etapas = {
  CORES: ['#DB2777', '#0E7490', '#A16207', '#4D7C0F', '#C2410C', '#64748B'],   // todas com contraste AA no branco
  MAX: 8,
  cfg() {
    const e = (typeof Store !== 'undefined' && Store.s && Store.s.etapas) || {};
    return { extras: Array.isArray(e.extras) ? e.extras : [], ocultas: Array.isArray(e.ocultas) ? e.ocultas : [], ordem: Array.isArray(e.ordem) ? e.ordem : [],
      nomes: e.nomes && typeof e.nomes === 'object' ? e.nomes : {} };
  },
  // Monta OS_STATUS e OS_ATIVOS (em ordem) a partir da configuração da loja
  aplicar() {
    const { extras, ocultas, ordem, nomes } = this.cfg();
    Object.keys(OS_STATUS).forEach(k => { if (k.startsWith('e_')) delete OS_STATUS[k]; else { delete OS_STATUS[k].oculto; OS_STATUS[k].label = OS_STATUS[k].padrao || (OS_STATUS[k].padrao = OS_STATUS[k].label); } });
    Object.entries(nomes).forEach(([k, v]) => { if (OS_STATUS[k] && ETAPAS_BASE.includes(k) && String(v || '').trim()) OS_STATUS[k].label = String(v).trim().slice(0, 28); });
    extras.forEach(x => { if (x && x.id && String(x.id).startsWith('e_')) OS_STATUS[x.id] = { label: String(x.label || 'Etapa'), icon: 'tag', color: x.cor || '#64748B', pill: '', extra: true, oculto: !!x.removida }; });
    ocultas.forEach(k => { if (OS_STATUS[k] && ETAPAS_BASE.includes(k) && !ETAPAS_FIXAS.includes(k)) OS_STATUS[k].oculto = true; });
    // OS num card que esta tela ainda não conhece (ex.: criado em outro aparelho): usa o nome guardado na OS
    ((typeof Store !== 'undefined' && Store.db && Store.db.os) || []).forEach(o => {
      if (o && !OS_STATUS[o.status] && /^e_/.test(o.status || '')) OS_STATUS[o.status] = { label: o.statusNome || 'Etapa', icon: 'tag', color: o.statusCor || '#64748B', pill: '', extra: true, oculto: true };
    });
    const vivo = k => OS_STATUS[k] && !OS_STATUS[k].oculto;
    const padrao = ['analise', 'aprovacao', 'peca', 'servico', ...extras.map(x => x && x.id), 'concluido'].filter(vivo);
    const lista = ordem.filter((k, i) => padrao.includes(k) && ordem.indexOf(k) === i);
    padrao.forEach(k => { if (!lista.includes(k)) { const i = lista.indexOf('concluido'); if (i < 0) lista.push(k); else lista.splice(i, 0, k); } });
    OS_ATIVOS.splice(0, OS_ATIVOS.length, ...lista);
  },
  // status que podem ser escolhidos (sem os cards removidos; o atual da OS sempre aparece)
  opcoes(atual) {
    const pos = k => { const i = OS_ATIVOS.indexOf(k); return i < 0 ? 100 + Object.keys(OS_STATUS).indexOf(k) : i; };
    return Object.entries(OS_STATUS).filter(([k, s]) => !s.oculto || k === atual).sort((a, b) => pos(a[0]) - pos(b[0]));
  },
  salvar(fn) {
    const e = this.cfg(); fn(e);
    Store.s.etapas = { extras: e.extras, ocultas: e.ocultas, ordem: e.ordem, nomes: e.nomes };
    Store.save(); this.aplicar();
  },
};
// Nome da forma de pagamento
const nomeForma = f => FORMAS_PGTO[f] || f || '';
// Garantia padrão dos serviços: 3 meses (a oficina muda em Configurações e cada OS pode ter a sua)
const GARANTIA_REPARO_DIAS = 90;
// Papéis na equipe. No banco o mecânico continua com o papel "tecnico" ("membro" é o nome antigo de atendente)
const PAPEIS = { dono: 'Dono', atendente: 'Atendente', membro: 'Atendente', tecnico: 'Mecânico', suporte: 'Suporte da plataforma' };
const FORMAS_PGTO = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de Débito', credito: 'Cartão de Crédito', transferencia: 'Transferência', outro: 'Outro' };
// Próxima revisão padrão (km e meses) por tipo; a oficina muda em Configurações
const REVISAO_PADRAO = { carro: { km: 10000, meses: 12 }, moto: { km: 3000, meses: 3 } };

function defaultDB() {
  return {
    version: 1,
    auth: null,
    settings: {
      loja: '',
      responsavel: '',
      cnpj: '',
      telefone: '',
      endereco: '',
      instagram: '',
      metaMensal: 50000,
      diasTrabalho: 26,
      garantiaDias: 90,
      termosGarantia: 'A garantia cobre exclusivamente o serviço executado e as peças substituídas descritas nesta ordem, pelo prazo ou pela quilometragem indicados (o que vier primeiro). Não cobre: desgaste natural, mau uso, acidentes, falta de manutenção, uso de combustível ou lubrificante inadequados, nem intervenção de terceiros nas peças reparadas.',
      termosGarantiaProduto: 'Peças e acessórios: garantia contra defeito de fabricação pelo prazo indicado. Não cobre instalação feita por terceiros, mau uso, acidentes nem desgaste natural. Guarde este recibo: ele é necessário para acionar a garantia.',
      termosEntrada: 'Veículos não retirados em até 90 dias após o aviso de conclusão serão considerados abandonados. A oficina não se responsabiliza por objetos pessoais deixados no veículo que não estejam anotados nesta ordem.',
      tiposVeiculo: ['carro', 'moto'],
      garantiaKm: 0,
      taxaDebito: 1.5,
      taxaCredito: 3.5,
      exigirCaixa: false,
      origens: ['Indicação', 'Google', 'Instagram', 'Passou na frente', 'WhatsApp', 'Facebook'],
      tecnicos: [],       // mecânicos (nome e assinatura); o nome interno ficou do sistema original
    },
    seq: { os: 1, orc: 1, venda: 1 },
    clientes: [],
    os: [],
    orcamentos: [],
    pecas: [],
    fornecedores: [],
    movEstoque: [],
    produtos: [],
    vendas: [],
    servicos: [],
    lancamentos: [],
    caixas: [],
    auditoria: [],
    pedidos: [],
    // SaaS etapa 3
    lotes: [],          // entrada de estoque com saldo próprio (baixa do mais antigo)
    nfe_entradas: [],   // notas de compra importadas por XML (id = chave da NF-e)
    followups: [],      // contatos a fazer com clientes (status, próximo contato, observações)
    metas_func: [],     // metas por funcionário (id = user_id)
    pedidos_vitrine: [], // pedidos feitos pelo cliente no carrinho da vitrine (retirada na loja)
  };
}

const Store = {
  db: null,
  load() {
    try { this.db = JSON.parse(localStorage.getItem(DB_KEY)); } catch { this.db = null; }
    const def = defaultDB();
    if (!this.db) this.db = def;
    for (const k in def) if (this.db[k] === undefined) this.db[k] = def[k];
    for (const k in def.settings) if (this.db.settings[k] === undefined) this.db.settings[k] = def.settings[k];
  },
  // noSync = true quando a alteração veio da nuvem (não precisa reenviar)
  save(noSync) {
    // loja em somente leitura (teste vencido, atraso além da tolerância ou bloqueio): desfaz a alteração na tela
    if (!noSync && typeof Cloud !== 'undefined' && Cloud.enabled && Cloud.loja && !Cloud.podeEscrever()) {
      this.load();
      if (typeof App !== 'undefined') { App.avisoSomenteLeitura(); setTimeout(() => { closeAllModals(); App.refresh(); }, 0); }
      return;
    }
    try { localStorage.setItem(DB_KEY, JSON.stringify(this.db)); }
    catch (e) { toast('Erro ao salvar: armazenamento cheio. Faça um backup.', true); }
    if (!noSync && typeof Cloud !== 'undefined') Cloud.schedule();
  },
  get s() { return this.db.settings; },

  log(acao, detalhe) {
    this.db.auditoria.unshift({ id: uid(), data: nowISO(), acao, detalhe });
    if (this.db.auditoria.length > 1000) this.db.auditoria.length = 1000;
  },

  // Próximo número considerando também registros criados em outros aparelhos
  next(kind) {
    const col = { os: 'os', orc: 'orcamentos', venda: 'vendas' }[kind];
    const max = Math.max(0, ...this.db[col].map(x => Number(x.numero) || 0));
    const n = Math.max(this.db.seq[kind] || 1, max + 1);
    this.db.seq[kind] = n + 1;
    return n;
  },

  /* ----- Clientes ----- */
  cliente(id) { return this.db.clientes.find(c => c.id === id); },
  clientesAtivos() { return this.db.clientes.filter(c => !c.deleted).sort((a, b) => a.nome.localeCompare(b.nome)); },
  saveCliente(c) {
    if (!c.id) { c.id = uid(); c.criadoEm = nowISO(); this.db.clientes.push(c); this.log('Cliente criado', c.nome); }
    else { const i = this.db.clientes.findIndex(x => x.id === c.id); this.db.clientes[i] = c; }
    this.save(); return c;
  },

  // Quem está usando o app (para metas por funcionário). Sem nuvem: ninguém (modo de um usuário só).
  quem() {
    if (typeof Cloud === 'undefined' || !Cloud.enabled || !Cloud.user) return {};
    return { id: Cloud.user.id, nome: Cloud.user.user_metadata?.nome || (Cloud.user.email || '').split('@')[0] };
  },

  // Oficina criada em outro idioma: termos de garantia e de entrada nascem nesse idioma
  // (só troca o que ainda é o texto padrão em português; o que a loja escreveu fica como está)
  aplicarPadroesIdioma(id) {
    const pt = defaultDB().settings, novos = PADROES_IDIOMA[id]; if (!novos) return;
    for (const k in novos) if (!this.s[k] || this.s[k] === pt[k]) this.s[k] = novos[k];
    this.save();
  },

  /* ----- OS ----- */
  osById(id) { return this.db.os.find(o => o.id === id); },
  // total = mão de obra + peças − desconto (OS com itens); OS simples: valor − desconto
  osTotal(o) { return typeof OSItens !== 'undefined' ? OSItens.totais(o).total : (Number(o.valor) || 0) - (Number(o.desconto) || 0); },
  osCustoPecas(o) { return typeof OSItens !== 'undefined' ? OSItens.totais(o).custo : (o.pecas || []).reduce((s, p) => s + (p.custo || 0) * (p.qtd || 1), 0); },
  saveOS(o) {
    if (!o.id) {
      o.id = uid(); o.numero = this.next('os'); o.criadoEm = nowISO();
      { const q = this.quem(); if (q.id) { o.criadoPor = q.id; o.criadoPorNome = q.nome; } }
      o.historico = [{ data: nowISO(), status: o.status, nota: 'OS aberta' }];
      this.db.os.push(o); this.log('OS criada', `#${o.numero}`);
    } else { const i = this.db.os.findIndex(x => x.id === o.id); this.db.os[i] = o; }
    if (typeof OSItens !== 'undefined') OSItens.gravarTotais(o);
    this.save(); return o;
  },
  // Mantém o lançamento financeiro de uma OS paga em sincronia após edição
  syncReceitaOS(o) {
    const l = this.db.lancamentos.find(l => l.origem === 'os' && l.refId === o.id);
    if (!l) return;
    l.valor = this.osTotal(o); l.custo = this.osCustoPecas(o);
    if (typeof OSItens !== 'undefined') Object.assign(l, OSItens.divisao(o));
    l.forma = o.pagamento?.forma || l.forma; l.parcelas = o.pagamento?.parcelas || 1; l.taxa = this.taxa(l.forma, l.valor, l.parcelas, 'os');
  },
  setOSStatus(o, status, pagamento) {
    if (o.status === status) return;
    const antes = o.status;
    o.status = status;
    // etapa criada pela oficina: o nome e a cor vão junto, para a página de acompanhamento do cliente
    const sx = OS_STATUS[status];
    if (sx && sx.extra) { o.statusNome = sx.label; o.statusCor = sx.color; } else { delete o.statusNome; delete o.statusCor; }
    o.historico = o.historico || [];
    o.historico.push(sx && sx.extra ? { data: nowISO(), status, nome: sx.label } : { data: nowISO(), status });
    // quem finalizou a OS (conta na meta dele): quem marcou "Pronto" ou, se foi direto para "Pago", quem recebeu
    const marcarQuem = () => { if (o.concluidoPor) return; const q = this.quem(); if (q.id) { o.concluidoPor = q.id; o.concluidoPorNome = q.nome; } };
    if (status === 'concluido') { if (!o.concluidoEm) o.concluidoEm = nowISO(); marcarQuem(); }
    if (status === 'pago') {
      o.pagamento = Object.assign({ forma: 'pix', data: nowISO() }, pagamento || {});
      o.pagoEm = o.pagamento.data;
      if (!o.concluidoEm) o.concluidoEm = o.pagoEm;
      marcarQuem();
      o.entregueEm = o.entregueEm || nowISO();
      this.addReceita({ origem: 'os', refId: o.id, desc: `OS #${o.numero}`, valor: this.osTotal(o), custo: this.osCustoPecas(o), forma: o.pagamento.forma, data: o.pagoEm,
        parcelas: o.pagamento.parcelas || 1, ...(typeof OSItens !== 'undefined' ? OSItens.divisao(o) : {}) });
    } else if (antes === 'pago') {
      this.db.lancamentos = this.db.lancamentos.filter(l => !(l.origem === 'os' && l.refId === o.id));
      o.pagamento = null; o.pagoEm = null;
    }
    this.log('Status OS', `#${o.numero}: ${OS_STATUS[antes]?.label} → ${OS_STATUS[status].label}`);
    this.save();
  },

  /* ----- Garantia e acompanhamento ----- */
  garantiaInicio(o) { return o.concluidoEm || o.pagoEm || o.entregueEm || null; },
  // prazo da garantia do serviço: o da própria OS; sem ele, o padrão da oficina (Configurações)
  garantiaDiasOS(o) { const d = parseInt(o?.garantiaDias ?? this.s.garantiaDias, 10); return d >= 0 ? d : GARANTIA_REPARO_DIAS; },
  garantiaFim(o) { const i = this.garantiaInicio(o); return i ? addDays(i, this.garantiaDiasOS(o)) : null; },
  // garantia por km (0 = sem limite de km): a da OS; sem ela, o padrão da oficina
  garantiaKmOS(o) { const k = parseInt(o?.garantiaKm ?? this.s.garantiaKm, 10); return k > 0 ? k : 0; },
  // atraso só conta antes de a OS ficar pronta (OS pronta ou paga nunca aparece como atrasada)
  osAtrasada(o) {
    return !!(o && !o.deleted && Store.s.usarPrevisao !== false && OS_ATIVOS.includes(o.status) && o.status !== 'concluido' && o.previsao && dayKey(o.previsao) < dayKey());
  },
  // Token secreto do link público da OS (gerado na primeira vez que o link é usado)
  tokenOS(o) {
    if (!o.token) {
      const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
      const r = crypto.getRandomValues(new Uint8Array(22));
      o.token = Array.from(r, b => abc[b % abc.length]).join('');
      this.saveOS(o);
    }
    return o.token;
  },
  linkOS(o) { return `${location.origin}/acompanhar/${this.tokenOS(o)}`; },

  /* ----- Financeiro ----- */
  // taxa da maquininha: débito; crédito por número de parcelas (tabela separada para Serviços e para o Balcão)
  taxa(forma, valor, parcelas = 1, origem = 'os') {
    if (forma === 'debito') return valor * (this.s.taxaDebito || 0) / 100;
    if (forma === 'credito') return valor * (typeof Parcelas !== 'undefined' ? Parcelas.taxa(parcelas, origem) : (this.s.taxaCredito || 0)) / 100;
    return 0;
  },
  caixaAberto() { return this.db.caixas.find(c => !c.fechadoEm); },
  addReceita({ origem, refId, desc, valor, custo = 0, forma = 'dinheiro', data = nowISO(), categoria, parcelas = 1, maoDeObra, pecas }) {
    if (typeof Cloud !== 'undefined' && Cloud.papel() === 'tecnico') return {}; // mecânico não lança no financeiro (o banco também recusa)
    const cx = this.caixaAberto();
    const l = { id: uid(), tipo: 'receita', origem, refId, desc, valor, custo, taxa: this.taxa(forma, valor, parcelas, origem === 'os' ? 'os' : 'balcao'), forma, parcelas, data,
      categoria: categoria || (origem === 'os' ? 'Serviços' : origem === 'venda' ? 'Balcão' : 'Outros'), caixaId: cx ? cx.id : null };
    // OS: mão de obra e peças separados (relatório mão de obra × peças); balcão: tudo é peça/produto
    if (origem === 'os') { l.maoDeObra = maoDeObra ?? valor; l.pecas = pecas ?? 0; } else if (origem === 'venda') { l.maoDeObra = 0; l.pecas = valor; }
    this.db.lancamentos.push(l); return l;
  },
  // estoque = compra de peças/mercadoria: sai do caixa, mas o custo só entra no lucro quando o item é vendido
  addDespesa({ desc, valor, forma = 'dinheiro', data = nowISO(), categoria = 'Despesas gerais', estoque = false }) {
    if (typeof Cloud !== 'undefined' && Cloud.papel() === 'tecnico') return {}; // mecânico não lança no financeiro (o banco também recusa)
    const cx = this.caixaAberto();
    const l = { id: uid(), tipo: 'despesa', origem: 'manual', desc, valor, custo: 0, taxa: 0, forma, data, categoria, estoque, caixaId: cx ? cx.id : null };
    this.db.lancamentos.push(l); this.log('Despesa', `${desc} ${money(valor)}`); this.save(); return l;
  },
  // lançamentos válidos: receita de venda cancelada não conta (mesmo que o lançamento tenha ficado para trás)
  lancs() {
    const canc = new Set(this.db.vendas.filter(v => v.cancelada || v.deleted).map(v => v.id));
    return canc.size ? this.db.lancamentos.filter(l => !(l.origem === 'venda' && canc.has(l.refId))) : this.db.lancamentos;
  },
  resumo(filtro) {
    const ls = this.lancs().filter(filtro);
    const r = { receita: 0, custo: 0, taxa: 0, despesa: 0, compras: 0, os: 0, vendas: 0, troca: 0, qtd: ls.length };
    for (const l of ls) {
      if (l.tipo === 'receita') {
        r.receita += l.valor; r.custo += l.custo || 0; r.taxa += l.taxa || 0;
        if (l.origem === 'os') r.os += l.valor; else if (l.origem === 'venda') r.vendas += l.valor;
      } else if (this.ehCompraEstoque(l)) r.compras += l.valor;
      else r.despesa += l.valor;
    }
    r.custos = r.custo + r.taxa + r.despesa;
    r.lucro = r.receita - r.custos;
    r.margem = r.receita ? (r.lucro / r.receita) * 100 : 0;
    return r;
  },
  ehCompraEstoque(l) { return l.estoque || /^Compra de (estoque|peças)$/.test(l.categoria || ''); },
  resumoDia(d = new Date()) { const k = dayKey(d); return this.resumo(l => dayKey(l.data) === k); },
  resumoMes(d = new Date()) { const k = monthKey(d); return this.resumo(l => monthKey(l.data) === k); },
  metaDiaria() { return (Number(this.s.metaMensal) || 0) / (Number(this.s.diasTrabalho) || 26); },

  /* ----- Estoque ----- */
  peca(id) { return this.db.pecas.find(p => p.id === id); },
  produto(id) { return this.db.produtos.find(p => p.id === id); },
  movimentar(tipoItem, item, qtd, motivo) {
    const antes = Number(item.qtd) || 0;
    item.qtd = antes + qtd;
    if (qtd < 0) this.baixarLotes(tipoItem, item, -qtd, antes);
    this.db.movEstoque.unshift({ id: uid(), data: nowISO(), tipoItem, itemId: item.id, nome: item.nome, qtd, motivo, saldo: item.qtd });
    if (this.db.movEstoque.length > 3000) this.db.movEstoque.length = 3000;
  },

  /* ----- Lotes ----- */
  lotesDe(tipoItem, itemId) {
    return this.db.lotes.filter(l => !l.deleted && l.itemId === itemId && (l.tipoItem || 'produto') === tipoItem)
      .sort((a, b) => String(a.data).localeCompare(String(b.data)));
  },
  // Saída de estoque: o que já existia antes dos lotes sai primeiro; depois, o lote mais antigo
  baixarLotes(tipoItem, item, q, antes) {
    const lotes = this.lotesDe(tipoItem, item.id).filter(l => l.saldo > 0);
    if (!lotes.length) return;
    const emLotes = lotes.reduce((s, l) => s + l.saldo, 0);
    let resta = q - Math.min(q, Math.max(0, antes - emLotes));
    for (const l of lotes) {
      if (resta <= 0) break;
      const t = Math.min(l.saldo, resta);
      l.saldo -= t; resta -= t;
    }
  },
  // Entrada com lote (XML de NF-e ou entrada manual em lote)
  criarLote({ tipoItem = 'produto', item, qtd, custo = 0, fornecedor = '', numero = '', validade = null, nfeChave = null, motivo }) {
    const l = { id: uid(), tipoItem, itemId: item.id, nome: item.nome, numero: numero || `L${(this.db.lotes.length + 1).toString().padStart(4, '0')}`,
      data: nowISO(), fornecedor, custo: Number(custo) || 0, qtdInicial: qtd, saldo: qtd, validade: validade || null, nfeChave };
    this.movimentar(tipoItem, item, qtd, motivo || `Entrada lote ${l.numero}`);
    this.db.lotes.push(l);
    return l;
  },
};

Store.load();

/* Parcelas no crédito: taxa da maquininha por número de parcelas e "sem juros até Nx",
   separadas em Serviços (OS) e Peças/produtos (balcão). Store.s.parcelas = { os: { taxas: { 1: 3.5, 2: 4.9 }, semJurosAte: 3, max: 12 }, balcao: {...} } */
const Parcelas = {
  cfg(origem) {
    const p = (Store.s.parcelas && Store.s.parcelas[origem === 'balcao' ? 'balcao' : 'os']) || {};
    return { taxas: p.taxas || {}, semJurosAte: parseInt(p.semJurosAte, 10) || 1, max: Math.min(24, parseInt(p.max, 10) || 12) };
  },
  // taxa (%) da maquininha para n parcelas; sem taxa própria da parcela: a taxa de crédito geral
  taxa(n, origem) {
    const c = this.cfg(origem), v = c.taxas[n] ?? c.taxas[String(n)];
    return v !== undefined && v !== '' && v !== null ? Number(v) || 0 : Number(Store.s.taxaCredito) || 0;
  },
  // campo "parcelas" no pagamento (só no crédito)
  campo(box, forma, total, origem) {
    if (!box) return;
    if (forma !== 'credito') { box.innerHTML = ''; return; }
    const c = this.cfg(origem), atual = parseInt($('select', box)?.value, 10) || 1;
    box.innerHTML = field('Parcelas', `<select class="input" name="parcelas">${Array.from({ length: c.max }, (_, i) => i + 1).map(n => `<option value="${n}" ${n === atual ? 'selected' : ''}>${n}x ${money(total / n)}${n <= c.semJurosAte ? ' ' + t('sem juros') : ''}</option>`).join('')}</select>`)
      + `<div class="xs muted" style="margin:-6px 0 10px">${t('Taxa da maquininha')}: ${String(this.taxa(atual, origem)).replace('.', ',')}% · ${t('sem juros até {n}x', { n: c.semJurosAte })}</div>`;
    $('select', box).onchange = () => this.campo(box, forma, total, origem);
  },
};
