/* Componentes de interface: toast, modal, confirmação, dropdown */
const Pages = {};
function toast(msg, err = false) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.innerHTML = icon(err ? 'alert' : 'checkCircle') + `<span>${esc(msg)}</span>`;
  root.appendChild(el);
  while (root.children.length > 2) root.firstChild.remove(); // no máximo 2 avisos na tela
  setTimeout(() => el.remove(), 3200);
}

const modalStack = [];
function openModal({ title, subtitle = '', icon: ic = 'file', body = '', foot = '', wide = false, onMount, onClose }) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <div class="ic">${icon(ic)}</div>
        <div class="grow"><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button class="icon-btn" data-close aria-label="Fechar">${icon('x')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  const m = { el: bd, close() { bd.remove(); const i = modalStack.indexOf(m); if (i >= 0) modalStack.splice(i, 1); onClose && onClose(); document.body.style.overflow = modalStack.length ? 'hidden' : ''; } };
  bd.addEventListener('mousedown', e => { if (e.target === bd) m.close(); });
  bd.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => m.close()));
  $('#modal-root').appendChild(bd);
  modalStack.push(m);
  document.body.style.overflow = 'hidden';
  onMount && onMount(bd, m);
  return m;
}
function closeAllModals() { while (modalStack.length) modalStack[modalStack.length - 1].close(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close(); });

function confirmDialog(msg, { title = 'Confirmar', ok = 'Confirmar', danger = false } = {}) {
  return new Promise(res => {
    let done = false;
    const m = openModal({
      title, icon: danger ? 'alert' : 'help',
      body: `<p style="margin:0">${esc(msg)}</p>`,
      foot: `<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(ok)}</button>`,
      onClose: () => { if (!done) res(false); },
    });
    $('#cf-ok', m.el).onclick = () => { done = true; m.close(); res(true); };
  });
}

function dropdown(anchor, items, onPick) {
  closeDropdown();
  const dd = document.createElement('div');
  dd.className = 'dropdown';
  dd.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.on ? 'on' : ''}">${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span>${it.on ? `<span class="ck">${icon('check')}</span>` : ''}</button>`).join('');
  document.body.appendChild(dd);
  const r = anchor.getBoundingClientRect();
  const h = dd.offsetHeight, w = dd.offsetWidth;
  let top = r.bottom + 6; if (top + h > innerHeight - 10) top = Math.max(10, r.top - h - 6);
  let left = Math.min(r.right - w, innerWidth - w - 10); left = Math.max(10, left);
  dd.style.top = top + 'px'; dd.style.left = left + 'px';
  dd.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; closeDropdown(); onPick(items[+b.dataset.i]); });
  setTimeout(() => document.addEventListener('click', closeDropdown, { once: true }), 0);
  window._dd = dd; dd._y = scrollY;
}
function closeDropdown() { if (window._dd) { window._dd.remove(); window._dd = null; } }
// fecha o menu só quando a página rolou de verdade (pequenos ajustes não contam)
addEventListener('scroll', () => { if (window._dd && Math.abs(scrollY - window._dd._y) > 40) closeDropdown(); }, true);

function pageHead(ic, title, sub) {
  return `<div class="page-head"><div class="page-icon">${icon(ic)}</div><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div></div>`;
}

function statusPill(st) {
  const s = OS_STATUS[st] || OS_STATUS.analise;
  return `<span class="pill ${s.pill}"${s.extra ? ` style="color:${s.color};border-color:${s.color}55;background:${s.color}14"` : ''}>${icon(s.icon, 'sm')}${esc(s.label)}</span>`;
}

// Lê todos os campos [name] de um container
function readForm(root) {
  const o = {};
  root.querySelectorAll('[name]').forEach(el => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value.trim();
  });
  return o;
}

function field(label, inner, { req = false, opt = false } = {}) {
  return `<div class="field"><label>${esc(label)}${req ? ' <span class="req">*</span>' : ''}${opt ? ' <span class="opt">(opcional)</span>' : ''}</label>${inner}</div>`;
}
function inputIcon(ic, attrs) { return `<div class="input-icon">${icon(ic)}<input class="input" ${attrs}></div>`; }
function selectOpts(map, sel) {
  const entries = Array.isArray(map) ? map.map(v => Array.isArray(v) ? v : [v, v]) : Object.entries(map);
  return entries.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

/* Assinatura em canvas */
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = canvas.offsetWidth * ratio; canvas.height = canvas.offsetHeight * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  let drawing = false, dirty = false, last;
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; dirty = true; });
  canvas.addEventListener('pointerup', () => drawing = false);
  canvas.addEventListener('pointercancel', () => drawing = false);
  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; },
    isEmpty: () => !dirty,
    toDataURL: () => canvas.toDataURL('image/png'),
  };
}

function paginate(list, page, per) {
  const pages = Math.max(1, Math.ceil(list.length / per));
  page = Math.min(Math.max(1, page), pages);
  return { items: list.slice((page - 1) * per, page * per), page, pages, from: list.length ? (page - 1) * per + 1 : 0, to: Math.min(page * per, list.length), total: list.length };
}
function pagerHTML(p, fn) {
  if (p.pages <= 1) return '';
  return `<div class="pager"><button class="btn sm" ${p.page <= 1 ? 'disabled' : ''} onclick="${fn}(${p.page - 1})">${icon('arrowLeft', 'sm')}</button><span class="muted small">Página ${p.page} de ${p.pages}</span><button class="btn sm" ${p.page >= p.pages ? 'disabled' : ''} onclick="${fn}(${p.page + 1})">${icon('arrowRight', 'sm')}</button></div>`;
}
