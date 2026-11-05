/* Build da Vercel: gera js/config.js e monta a pasta dist/ só com o que o navegador precisa.
   - Publica apenas páginas, css, js, imagens, manifest e sw.js. Banco (supabase/), documentação (docs/),
     scripts e o código do servidor (api/, middleware.js) NÃO vão para o site público.
   - JavaScript e CSS saem minificados (sem comentários, nomes internos encurtados), o que dificulta copiar.
     Os nomes globais entre os arquivos (ex.: Store, Cloud) são mantidos, então nada quebra.
   - Sem o esbuild instalado, copia os arquivos como estão (o site continua funcionando). */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const dist = path.join(raiz, 'dist');

execFileSync(process.execPath, [path.join(__dirname, 'gerar-config.cjs')], { stdio: 'inherit' });

let esbuild = null;
try { esbuild = require('esbuild'); } catch { console.warn('[build] esbuild não instalado: copiando sem minificar'); }

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const minificar = (arquivo, codigo) => {
  if (!esbuild) return codigo;
  const ext = path.extname(arquivo);
  if (ext === '.js') return arquivo.includes(`${path.sep}vendor${path.sep}`) ? codigo : esbuild.transformSync(codigo, { loader: 'js', minify: true, legalComments: 'none' }).code;
  if (ext === '.css') return esbuild.transformSync(codigo, { loader: 'css', minify: true, legalComments: 'none' }).code;
  if (ext === '.html') return codigo.replace(/<!--(?!\[if)[\s\S]*?-->/g, '');
  return codigo;
};

const copiar = rel => {
  const de = path.join(raiz, rel), para = path.join(dist, rel);
  if (!fs.existsSync(de)) return;
  if (fs.statSync(de).isDirectory()) { for (const f of fs.readdirSync(de)) copiar(path.join(rel, f)); return; }
  fs.mkdirSync(path.dirname(para), { recursive: true });
  const ext = path.extname(rel);
  if (['.js', '.css', '.html'].includes(ext)) fs.writeFileSync(para, minificar(rel, fs.readFileSync(de, 'utf8')));
  else fs.copyFileSync(de, para);
};

const publicos = [
  ...fs.readdirSync(raiz).filter(f => f.endsWith('.html')),
  'manifest.webmanifest', 'sw.js', 'css', 'js', 'assets',
];
publicos.forEach(copiar);

// código desta publicação (commit da Vercel; fora dela, a hora do build): o app aberto compara com /versao.json
const build = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || Date.now().toString(36);
const appJs = path.join(dist, 'js', 'app.js');
const codigo = fs.readFileSync(appJs, 'utf8');
if (!codigo.includes('__BUILD_ID__')) throw new Error('[build] marcador __BUILD_ID__ não encontrado em js/app.js');
fs.writeFileSync(appJs, codigo.replace('__BUILD_ID__', build));
fs.writeFileSync(path.join(dist, 'versao.json'), JSON.stringify({ build }));
console.log(`[build] versão ${build}`);

const total = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? total(path.join(dir, d.name)) : 1), 0);
console.log(`[build] dist/ pronto: ${total(dist)} arquivos${esbuild ? ' (js e css minificados)' : ''}`);
