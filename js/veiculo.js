/* Veículos da oficina: placa, carro/moto, checklist de entrada, combustível e catálogo de serviços.
   - Todo veículo guarda tipo: 'carro' | 'moto'. O formulário e os ícones mudam conforme o tipo.
   - A placa é guardada sem hífen e em maiúsculas. A placa antiga e a Mercosul do mesmo veículo
     (ABC1234 ↔ ABC1C34) contam como o mesmo veículo (Placa.chave).
   - O que a oficina personaliza (checklist, catálogo) fica nas configurações; os padrões são
     calculados na leitura (só o que a oficina mudou é guardado). */

const Placa = {
  // ABC-1234, abc 1d23 → ABC1234 / ABC1D23
  norm(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7); },
  antiga(p) { return /^[A-Z]{3}\d{4}$/.test(this.norm(p)); },
  mercosul(p) { return /^[A-Z]{3}\d[A-Z]\d{2}$/.test(this.norm(p)); },
  valida(p) { return this.antiga(p) || this.mercosul(p); },
  // forma de comparação: a 5ª posição da Mercosul (letra A–J) vira o número da placa antiga
  chave(p) {
    const n = this.norm(p);
    if (/^[A-Z]{3}\d[A-J]\d{2}$/.test(n)) return n.slice(0, 4) + String('ABCDEFGHIJ'.indexOf(n[4])) + n.slice(5);
    return n;
  },
  mesma(a, b) { const x = this.chave(a); return !!x && x === this.chave(b); },
  // para mostrar: antiga com hífen (ABC-1234); Mercosul como no documento (ABC1D23)
  fmt(p) { const n = this.norm(p); return this.antiga(n) ? `${n.slice(0, 3)}-${n.slice(3)}` : n; },
  // link público do cliente: ABC•••3
  mascarar(p) { const n = this.norm(p); return n.length >= 4 ? `${n.slice(0, 3)}•••${n.slice(-1)}` : ''; },
  // a busca ignora hífen, espaço e maiúsculas (e acha a placa antiga pela Mercosul e vice-versa)
  bate(q, p) {
    const nq = this.norm(q); if (nq.length < 3 || !p) return false;
    if (this.norm(p).includes(nq)) return true;
    return nq.length === 7 && this.mesma(nq, p);
  },
};

const TIPOS_VEICULO = { carro: { label: 'Carro', icone: 'car' }, moto: { label: 'Moto', icone: 'moto' } };
const COMBUSTIVEIS = { flex: 'Flex', gasolina: 'Gasolina', etanol: 'Etanol', diesel: 'Diesel', gnv: 'GNV', eletrico: 'Elétrico', hibrido: 'Híbrido' };
const CAMBIOS = { manual: 'Manual', automatico: 'Automático', cvt: 'CVT' };
const PARTIDAS = { pedal: 'Pedal', eletrica: 'Elétrica' };
const FREIOS_MOTO = { tambor: 'Tambor', disco: 'Disco', abs: 'ABS' };
// nível de combustível na entrada (seletor visual)
const NIVEIS_COMBUSTIVEL = [['0', 'Vazio'], ['1/4', '1/4'], ['1/2', '1/2'], ['3/4', '3/4'], ['1', 'Cheio']];
const ESTADOS_CHECKLIST = { ok: 'OK', nok: 'Com defeito', nv: 'Não verificado' };

// Checklist de entrada padrão por tipo (a oficina edita em Configurações)
const CHECKLIST_PADRAO = {
  carro: [
    'Lataria e pintura', 'Para-brisa e vidros', 'Faróis e lanternas', 'Pneus', 'Estepe',
    'Freios', 'Suspensão', 'Nível de óleo', 'Arrefecimento', 'Bateria', 'Ar-condicionado',
    'Painel (luzes acesas)', 'Som / multimídia',
    'Macaco', 'Chave de roda', 'Triângulo', 'Documentos', 'Objetos pessoais',
  ],
  moto: [
    'Freio dianteiro', 'Freio traseiro', 'Pneus', 'Relação (coroa, pinhão, corrente)', 'Nível de óleo', 'Embreagem',
    'Luzes e setas', 'Buzina', 'Painel', 'Bateria', 'Partida', 'Suspensão', 'Retrovisores', 'Carenagem e pintura',
  ],
};

// Catálogo de serviços criado com a oficina (preço em branco: a oficina preenche; garantia em dias e km)
const CATALOGO_PADRAO = {
  carro: [
    ['Troca de óleo e filtros', 90, 5000], ['Revisão', 90, 5000], ['Alinhamento e balanceamento', 30, 1000],
    ['Freios (pastilhas e discos)', 90, 5000], ['Suspensão', 90, 10000], ['Embreagem', 90, 10000],
    ['Correia dentada', 90, 10000], ['Arrefecimento', 90, 5000], ['Injeção eletrônica / scanner', 90, 5000],
    ['Elétrica', 90, 0], ['Ar-condicionado', 90, 0], ['Troca de bateria', 90, 0], ['Troca de pneus', 90, 5000],
  ],
  moto: [
    ['Troca de óleo', 30, 1000], ['Revisão', 90, 3000], ['Relação (coroa, pinhão e corrente)', 90, 5000],
    ['Pastilhas / lonas de freio', 90, 3000], ['Pneus', 90, 3000], ['Regulagem', 30, 1000], ['Elétrica', 90, 0],
    ['Injeção / carburador', 90, 3000], ['Embreagem', 90, 5000], ['Suspensão', 90, 5000],
  ],
};

const Veiculo = {
  // tipos que a oficina atende (Configurações): o que não é atendido some das telas
  tipos() {
    const t = (typeof Store !== 'undefined' && Store.s && Store.s.tiposVeiculo) || ['carro', 'moto'];
    const v = t.filter(x => TIPOS_VEICULO[x]);
    return v.length ? v : ['carro', 'moto'];
  },
  tipoPadrao() { return this.tipos()[0]; },
  icone(v) { return (TIPOS_VEICULO[v?.tipo] || TIPOS_VEICULO.carro).icone; },
  rotuloTipo(v) { return t((TIPOS_VEICULO[v?.tipo] || TIPOS_VEICULO.carro).label); },
  // "Onix 1.0 2019" / "CG 160 Fan 2021" (para mensagens e cotação)
  nome(v) {
    if (!v) return '';
    const ano = v.anoModelo || v.anoFab || '';
    return [v.modelo, v.versao || (v.tipo === 'carro' ? v.motor : v.cilindrada ? v.cilindrada + 'cc' : ''), ano].filter(Boolean).join(' ').trim();
  },
  // "Chevrolet Onix 1.0 2019"
  completo(v) { return v ? [v.marca, this.nome(v)].filter(Boolean).join(' ').trim() : ''; },
  // "Onix 1.0 2019 · ABC1D23"
  resumo(v) { return v ? [this.completo(v), v.placa ? Placa.fmt(v.placa) : ''].filter(Boolean).join(' · ') : ''; },

  // todos os veículos da oficina, com o cliente de cada um
  todos() {
    const out = [];
    for (const c of Store.db.clientes) if (!c.deleted) for (const v of c.veiculos || []) out.push({ cliente: c, veiculo: v });
    return out;
  },
  // placa já cadastrada (checagem no app, porque ele funciona sem internet)
  porPlaca(placa, ignorarId) {
    if (!Placa.norm(placa)) return null;
    return this.todos().find(x => x.veiculo.id !== ignorarId && Placa.mesma(x.veiculo.placa, placa)) || null;
  },
  // histórico do veículo: todas as OS da mesma placa (de qualquer cliente) ou do mesmo veículo
  historico(v) {
    if (!v) return [];
    return Store.db.os.filter(o => !o.deleted && o.veiculo && ((v.placa && Placa.mesma(o.veiculo.placa, v.placa)) || (v.id && o.veiculo.id === v.id)))
      .sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
  },

  /* ---------- formulário ---------- */
  campos(v = {}, { prefixo = 've' } = {}) {
    const tipos = this.tipos(), tipo = tipos.includes(v.tipo) ? v.tipo : this.tipoPadrao();
    const anos = (() => { const a = new Date().getFullYear() + 1; return Array.from({ length: 60 }, (_, i) => String(a - i)); })();
    const dl = `dl-${prefixo}-marcas`;
    const marcas = [...new Set(this.todos().map(x => x.veiculo.marca).filter(Boolean).concat(tipo === 'moto' ? MARCAS.moto : MARCAS.carro))].slice(0, 200);
    return `<div class="veiculo-form" data-tipo="${tipo}">
      <input type="hidden" name="vid" value="${esc(v.id || '')}">
      <input type="hidden" name="tipo" value="${tipo}">
      ${tipos.length > 1 ? `<div class="seg-tipo mb" role="group" aria-label="${t('Tipo de veículo')}">${tipos.map(k => `<button type="button" class="chip-opt ${tipo === k ? 'on' : ''}" data-vtipo="${k}">${icon(TIPOS_VEICULO[k].icone)} ${t(TIPOS_VEICULO[k].label)}</button>`).join('')}</div>` : ''}
      <div class="form-row">
        ${field('Placa', `<input class="input placa-input" name="placa" autocapitalize="characters" autocomplete="off" maxlength="8" placeholder="ABC1D23" value="${esc(v.placa ? Placa.fmt(v.placa) : '')}"><div class="xs placa-aviso" aria-live="polite"></div>`)}
        ${field('Marca', `<input class="input" name="marca" list="${dl}" placeholder="${tipo === 'moto' ? 'Ex: Honda' : 'Ex: Chevrolet'}" value="${esc(v.marca || '')}">`)}
      </div>
      <datalist id="${dl}">${marcas.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <div class="form-row">
        ${field('Modelo', `<input class="input" name="modelo" placeholder="${tipo === 'moto' ? 'Ex: CG 160 Fan' : 'Ex: Onix'}" value="${esc(v.modelo || '')}">`, { req: true })}
        ${field('Versão', `<input class="input" name="versao" placeholder="${tipo === 'moto' ? 'Ex: ESDi' : 'Ex: LT 1.0 Turbo'}" value="${esc(v.versao || '')}">`, { opt: true })}
      </div>
      <div class="form-row">
        ${field('Ano de fabricação', `<select class="input" name="anoFab"><option value="">—</option>${selectOpts(anos, v.anoFab)}</select>`, { opt: true })}
        ${field('Ano do modelo', `<select class="input" name="anoModelo"><option value="">—</option>${selectOpts(anos, v.anoModelo)}</select>`, { opt: true })}
      </div>
      <div class="form-row">
        ${field('Cor', `<input class="input" name="cor" placeholder="Ex: Prata" value="${esc(v.cor || '')}">`, { opt: true })}
        ${field('Km', `<input class="input" name="km" inputmode="numeric" placeholder="Ex: 45.000" value="${v.km ? fmtKm(v.km, false) : ''}">`, { opt: true })}
      </div>
      <div class="form-row">
        ${field('Combustível', `<select class="input" name="combustivel"><option value="">—</option>${selectOpts(COMBUSTIVEIS, v.combustivel)}</select>`, { opt: true })}
        ${field('Chassi', `<input class="input" name="chassi" autocapitalize="characters" maxlength="17" placeholder="17 caracteres" value="${esc(v.chassi || '')}">`, { opt: true })}
      </div>
      <div class="form-row so-carro">
        ${field('Motor', `<input class="input" name="motor" placeholder="Ex: 1.0, 2.0" value="${esc(v.motor || '')}">`, { opt: true })}
        ${field('Câmbio', `<select class="input" name="cambio"><option value="">—</option>${selectOpts(CAMBIOS, v.cambio)}</select>`, { opt: true })}
      </div>
      <div class="form-row so-moto">
        ${field('Cilindrada (cc)', `<input class="input" name="cilindrada" inputmode="numeric" placeholder="Ex: 160" value="${esc(v.cilindrada || '')}">`, { opt: true })}
        ${field('Partida', `<select class="input" name="partida"><option value="">—</option>${selectOpts(PARTIDAS, v.partida)}</select>`, { opt: true })}
      </div>
      <div class="so-moto">${field('Freio', `<select class="input" name="freio"><option value="">—</option>${selectOpts(FREIOS_MOTO, v.freio)}</select>`, { opt: true })}</div>
      ${field('Observações do veículo', `<input class="input" name="vobs" placeholder="Ex: rodas aro 17, som original" value="${esc(v.obs || '')}">`, { opt: true })}
    </div>`;
  },
  // liga o formulário: troca de tipo e aviso da placa (formato estranho e placa repetida)
  ligar(root, { aoUsarCadastro } = {}) {
    const f = $('.veiculo-form', root); if (!f) return;
    const mostrarTipo = tipo => {
      f.dataset.tipo = tipo; $('[name=tipo]', f).value = tipo;
      $$('.so-carro', f).forEach(e => { e.hidden = tipo !== 'carro'; });
      $$('.so-moto', f).forEach(e => { e.hidden = tipo !== 'moto'; });
      $$('[data-vtipo]', f).forEach(b => b.classList.toggle('on', b.dataset.vtipo === tipo));
      $('[name=marca]', f).placeholder = t(tipo === 'moto' ? 'Ex: Honda' : 'Ex: Chevrolet');
      $('[name=modelo]', f).placeholder = t(tipo === 'moto' ? 'Ex: CG 160 Fan' : 'Ex: Onix');
    };
    $$('[data-vtipo]', f).forEach(b => b.onclick = () => mostrarTipo(b.dataset.vtipo));
    mostrarTipo(f.dataset.tipo);
    const km = $('[name=km]', f); km.oninput = () => { const d = onlyDigits(km.value).slice(0, 7); km.value = d ? fmtKm(+d, false) : ''; };
    const pl = $('[name=placa]', f), aviso = $('.placa-aviso', f);
    const checar = () => {
      const n = Placa.norm(pl.value); aviso.innerHTML = ''; aviso.className = 'xs placa-aviso';
      if (!n) return;
      const dono = this.porPlaca(n, $('[name=vid]', f).value);
      if (dono) {
        aviso.className = 'xs placa-aviso orange';
        aviso.innerHTML = `${icon('alert', 'sm')} ${esc(t('Placa já cadastrada em {cliente}', { cliente: dono.cliente.nome }))}`
          + (aoUsarCadastro ? ` <button type="button" class="btn sm outline-gold" data-usar-cadastro>${t('Usar este cadastro')}</button>` : '');
        const b = $('[data-usar-cadastro]', aviso); if (b) b.onclick = () => aoUsarCadastro(dono);
      } else if (n.length >= 7 && !Placa.valida(n)) {
        aviso.className = 'xs placa-aviso orange';
        aviso.textContent = t('Formato de placa diferente do comum (ABC1D23 ou ABC-1234). Confira, mas dá para salvar assim.');
      }
    };
    pl.oninput = () => { const pos = pl.selectionStart; pl.value = pl.value.toUpperCase(); try { pl.setSelectionRange(pos, pos); } catch {} checar(); };
    pl.onblur = () => { if (Placa.valida(pl.value)) pl.value = Placa.fmt(pl.value); };
    checar();
  },
  ler(root) {
    const f = $('.veiculo-form', root); if (!f) return null;
    const d = readForm(f), tipo = d.tipo === 'moto' ? 'moto' : 'carro';
    const v = {
      id: d.vid || uid(), tipo, placa: Placa.norm(d.placa), marca: d.marca.trim(), modelo: d.modelo.trim(), versao: d.versao.trim(),
      anoFab: d.anoFab, anoModelo: d.anoModelo, cor: d.cor.trim(), km: parseInt(onlyDigits(d.km), 10) || null,
      combustivel: d.combustivel, chassi: String(d.chassi || '').toUpperCase().trim(), obs: d.vobs.trim(),
    };
    if (tipo === 'carro') Object.assign(v, { motor: d.motor.trim(), cambio: d.cambio });
    else Object.assign(v, { cilindrada: onlyDigits(d.cilindrada), partida: d.partida, freio: d.freio });
    Object.keys(v).forEach(k => { if (v[k] === '' || v[k] === null) delete v[k]; });
    return v;
  },

  /* ---------- detalhes para mostrar ---------- */
  detalhesHTML(v) {
    if (!v) return '';
    const kv = (k, val) => val ? `<div class="kv"><span class="k">${t(k)}</span><span class="v">${val}</span></div>` : '';
    return kv('Placa', v.placa ? `<b class="placa-tag" data-no-i18n>${esc(Placa.fmt(v.placa))}</b>` : '')
      + kv('Veículo', `<span data-no-i18n>${esc(this.completo(v)) || '—'}</span>`)
      + kv('Tipo', esc(this.rotuloTipo(v)))
      + kv('Cor', esc(v.cor || ''))
      + kv('Combustível', esc(t(COMBUSTIVEIS[v.combustivel] || '')))
      + (v.tipo === 'moto'
        ? kv('Cilindrada', v.cilindrada ? esc(v.cilindrada) + ' cc' : '') + kv('Partida', esc(t(PARTIDAS[v.partida] || ''))) + kv('Freio', esc(t(FREIOS_MOTO[v.freio] || '')))
        : kv('Motor', esc(v.motor || '')) + kv('Câmbio', esc(t(CAMBIOS[v.cambio] || ''))))
      + kv('Chassi', v.chassi ? `<span data-no-i18n>${esc(v.chassi)}</span>` : '')
      + kv('Observações', esc(v.obs || ''));
  },
};

// Marcas mais comuns (sugestões no campo; a oficina digita qualquer uma)
const MARCAS = {
  carro: ['Chevrolet', 'Volkswagen', 'Fiat', 'Ford', 'Toyota', 'Hyundai', 'Honda', 'Renault', 'Jeep', 'Nissan', 'Peugeot', 'Citroën', 'Mitsubishi', 'Kia', 'BYD', 'Caoa Chery', 'BMW', 'Mercedes-Benz', 'Audi'],
  moto: ['Honda', 'Yamaha', 'Suzuki', 'Kawasaki', 'BMW', 'Royal Enfield', 'Triumph', 'Haojue', 'Shineray', 'Dafra', 'Harley-Davidson'],
};

// km com ponto de milhar: 45000 → "45.000 km"
function fmtKm(n, comUnidade = true) {
  const v = Number(n); if (!v && v !== 0) return '';
  const s = Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return comUnidade ? `${s} km` : s;
}

/* Checklist de entrada: a lista vem da oficina (por tipo) ou do padrão. Cada OS guarda a lista usada
   (checklistItens), para as OS antigas não mudarem quando a oficina edita o checklist. */
const Checklist = {
  itens(tipo) {
    const cfg = (typeof Store !== 'undefined' && Store.s && Store.s.checklist) || {};
    const l = Array.isArray(cfg[tipo]) ? cfg[tipo].filter(Boolean) : null;
    return l && l.length ? l : (CHECKLIST_PADRAO[tipo] || CHECKLIST_PADRAO.carro).slice();
  },
  // itens de uma OS (a lista que foi usada na entrada; OS sem lista: a do tipo)
  daOS(o) { return Array.isArray(o.checklistItens) && o.checklistItens.length ? o.checklistItens : this.itens(o.veiculo?.tipo || 'carro'); },
  campoHTML(itens, valores = {}) {
    return `<div class="ck-lista" id="ck">${itens.map(i => {
      const v = valores[i] || '';
      return `<div class="ck-linha"><span class="grow">${esc(i)}</span><span class="ck-seg" role="group" aria-label="${esc(i)}">
        ${Object.entries(ESTADOS_CHECKLIST).map(([k, l]) => `<button type="button" class="ck-b ck-${k} ${v === k ? 'on' : ''}" data-ck="${esc(i)}" data-v="${k}" title="${t(l)}" aria-pressed="${v === k}">${k === 'ok' ? '✓' : k === 'nok' ? '✗' : '?'}</button>`).join('')}
      </span></div>`;
    }).join('')}</div>`;
  },
  ligar(root) {
    $$('[data-ck]', root).forEach(b => b.onclick = () => {
      const on = !b.classList.contains('on');
      $$(`[data-ck="${CSS.escape(b.dataset.ck)}"]`, root).forEach(x => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      if (on) { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); }
    });
  },
  ler(root) {
    const r = {};
    $$('[data-ck].on', root).forEach(b => { r[b.dataset.ck] = b.dataset.v; });
    return r;
  },
  // pílulas para a tela (detalhe da OS)
  pilulasHTML(o) {
    const ck = o.checklist || {}; const itens = this.daOS(o).filter(i => ck[i]);
    return itens.length ? `<div class="row wrap mt" style="gap:6px">${itens.map(i => `<span class="pill ${ck[i] === 'ok' ? 'green' : ck[i] === 'nok' ? 'red' : ''} xs">${ck[i] === 'ok' ? '✓' : ck[i] === 'nok' ? '✗' : '?'} ${esc(i)}</span>`).join('')}</div>` : '';
  },
};

// Seletor visual do combustível na entrada
const Combustivel = {
  campoHTML(v) {
    return `<div class="comb-sel" role="radiogroup" aria-label="${t('Combustível')}">${NIVEIS_COMBUSTIVEL.map(([k, l], i) =>
      `<button type="button" class="comb-b ${String(v) === k ? 'on' : ''}" data-comb="${k}" role="radio" aria-checked="${String(v) === k}"><span class="comb-barra" style="--n:${i}"></span><span>${t(l)}</span></button>`).join('')}<input type="hidden" name="nivelCombustivel" value="${esc(v ?? '')}"></div>`;
  },
  ligar(root) {
    $$('[data-comb]', root).forEach(b => b.onclick = () => {
      $$('[data-comb]', root).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
      $('[name=nivelCombustivel]', root).value = b.dataset.comb;
    });
  },
  rotulo(v) { const n = NIVEIS_COMBUSTIVEL.find(x => x[0] === String(v)); return n ? t(n[1]) : ''; },
};

// Catálogo padrão: criado com a oficina, conforme os tipos atendidos (não duplica)
function semearCatalogo(tipos) {
  const ja = new Set(Store.db.servicos.filter(s => !s.deleted).map(s => `${s.tipo || ''}|${norm(s.nome)}`));
  for (const tipo of tipos) for (const [nome, dias, km] of CATALOGO_PADRAO[tipo] || []) {
    if (ja.has(`${tipo}|${norm(nome)}`)) continue;
    Store.db.servicos.push({ id: uid(), nome, tipo, preco: 0, garantiaDias: dias, garantiaKm: km, padrao: true, criadoEm: nowISO() });
  }
}

// validação do CPF (avisa, não bloqueia)
function cpfValido(s) {
  const d = onlyDigits(s);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => { let soma = 0; for (let i = 0; i < n; i++) soma += +d[i] * (n + 1 - i); const r = (soma * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === +d[9] && dv(10) === +d[10];
}

// "3 meses ou 5.000 km, o que vier primeiro" (só prazo quando não há limite de km)
function textoGarantia(o) {
  const d = Store.garantiaDiasOS(o), k = Store.garantiaKmOS(o);
  if (!k) return prazoGarantia(d);
  if (!d) return fmtKm(k);
  return t('{prazo} ou {km}, o que vier primeiro', { prazo: prazoGarantia(d), km: fmtKm(k) });
}

// Categorias de peças (sugestões; a oficina edita em Configurações)
const CATEGORIAS_PECAS = ['Freios', 'Filtros', 'Óleos e fluidos', 'Suspensão', 'Motor', 'Embreagem', 'Arrefecimento', 'Elétrica', 'Ignição', 'Injeção', 'Pneus', 'Transmissão', 'Acessórios'];

// Textos dos documentos: os da oficina (Configurações) ou os padrão
const Termos = {
  CLAUSULA_ABANDONO: 'Veículos não retirados em até 90 dias após o aviso de conclusão serão considerados abandonados.',
  // termo de entrada sempre com a cláusula de abandono (90 dias após o aviso)
  entrada() {
    const txt = String(Store.s.termosEntrada || '').trim() || defaultDB().settings.termosEntrada;
    return /abandon/i.test(txt) ? txt : `${txt} ${t(this.CLAUSULA_ABANDONO)}`.trim();
  },
  garantia() { return String(Store.s.termosGarantia || '').trim() || defaultDB().settings.termosGarantia; },
  rodape() { return String(Store.s.rodapePdf || '').trim() || `${t('Obrigado pela preferência!')} ${Store.s.loja || ''}`.trim(); },
};
