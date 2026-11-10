/* Teste de aceitação do "Preencher OS por voz" com o Gemini DE VERDADE.
   Uso: GEMINI_API_KEY=... node scripts/testar-voz.mjs fala1.mp3 fala2.mp3 fala3.mp3
   (GEMINI_MODEL opcional). Os arquivos são as 3 falas do documento, gravadas ou geradas por voz sintética.
   Usa a mesma função do servidor (api/_lib/voz.js) e uma lista de serviços/peças de exemplo. */
import fs from 'node:fs';
import path from 'node:path';
import { chamarGemini, limpar, MODELO_PADRAO } from '../api/_lib/voz.js';

const catalogo = {
  servicos: [['sv-oleo', 'Troca de óleo'], ['sv-relacao', 'Relação (coroa, pinhão e corrente)'], ['sv-revisao', 'Revisão'], ['sv-freio', 'Pastilhas / lonas de freio'], ['sv-eletrica', 'Elétrica']].map(([id, nome]) => ({ id, nome })),
  pecas: [['pc-past-tras', 'Pastilha de freio traseira'], ['pc-past-diant', 'Pastilha de freio dianteira'], ['pc-vela', 'Vela de ignição'], ['pc-bateria', 'Bateria 5Ah'], ['pc-oleo', 'Óleo 10W30 1L']].map(([id, nome]) => ({ id, nome })),
};
const ESPERADO = [
  d => [['placa', d.placa === 'ABC1D23'], ['modelo', /cg ?160/i.test(d.modelo_moto || '')], ['km', d.km === 32000], ['cliente', /jo[aã]o/i.test(d.nome_cliente || '')],
    ['serviços óleo + relação', d.servicos.some(s => s.id_cadastro === 'sv-oleo') && d.servicos.some(s => s.id_cadastro === 'sv-relacao')], ['defeito freio', /freio/i.test(d.defeito_relatado || '')]],
  d => [['modelo', /fazer ?250/i.test(d.modelo_moto || '')], ['cliente', /marcos/i.test(d.nome_cliente || '')], ['telefone', (d.telefone_cliente || '').endsWith('48999998888') || d.telefone_cliente === '48999998888'],
    ['revisão', d.servicos.some(s => s.id_cadastro === 'sv-revisao')], ['pastilha traseira', d.pecas.some(p => p.id_cadastro === 'pc-past-tras')], ['sem placa (vazia)', d.placa === null && d.campos_incertos.includes('placa')]],
  d => [['modelo', /biz/i.test(d.modelo_moto || '')], ['cliente', /maria/i.test(d.nome_cliente || '')], ['defeito', /pega|partida|manh/i.test(d.defeito_relatado || '')],
    ['bateria e vela', [...d.servicos, ...d.pecas].some(x => /bateria/i.test(x.nome || '') || x.id_cadastro === 'pc-bateria') && [...d.servicos, ...d.pecas].some(x => /vela/i.test(x.nome || '') || x.id_cadastro === 'pc-vela')],
    ['placa vazia e destacada', d.placa === null && d.campos_incertos.includes('placa')]],
];
const tipo = f => ({ '.mp3': 'audio/mp3', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.aac': 'audio/aac', '.webm': 'audio/webm' })[path.extname(f).toLowerCase()] || 'audio/mp3';
let falhas = 0;
for (const [i, arq] of process.argv.slice(2).entries()) {
  const bruto = await chamarGemini({ audioB64: fs.readFileSync(arq).toString('base64'), mime: tipo(arq), catalogo, chave: process.env.GEMINI_API_KEY, modelo: process.env.GEMINI_MODEL || MODELO_PADRAO });
  const d = limpar(bruto, catalogo);
  console.log(`\n=== Fala ${i + 1} (${path.basename(arq)}) ===\n` + JSON.stringify(d, null, 2));
  for (const [nome, ok] of (ESPERADO[i] || (() => []))(d)) { console.log(`${ok ? '✅' : '❌'} ${nome}`); if (!ok) falhas++; }
}
console.log(falhas ? `\n${falhas} verificação(ões) falharam` : '\nTodas as verificações passaram');
process.exit(falhas ? 1 : 0);
