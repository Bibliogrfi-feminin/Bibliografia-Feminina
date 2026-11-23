/**
 * Gera os arquivos estáticos que o site público consome.
 *
 *   dados/base-processualistas.xlsx   (fonte, versionada no repositório)
 *        ↓  node scripts/gerar-dados.mjs
 *   public/dados/*.json               (o que o navegador baixa)
 *
 * Por que não ler o .xlsx no navegador: medido nesta base, o Excel custa
 * 780 KB e ~150 ms de processamento (descompactar o zip + varrer 44 mil
 * células de XML) contra 475 KB e ~30 ms do JSON equivalente. O .xlsx já é
 * um zip, então ainda por cima não comprime de novo na rede.
 *
 * O conteúdo institucional (textos das páginas e equipe) não está na
 * planilha: é lido do Supabase no momento da geração e congelado aqui, de
 * modo que o site público não precise consultar o banco em nenhuma tela.
 *
 * Uso:
 *   node scripts/gerar-dados.mjs
 *   node scripts/gerar-dados.mjs --sem-supabase   (mantém o conteúdo atual)
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import https from "node:https";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLANILHA = path.join(RAIZ, "dados", "base-processualistas.xlsx");
const SAIDA = path.join(RAIZ, "public", "dados");

const SB_URL = process.env.VITE_SUPABASE_URL || "https://jljqkxkncubvcxyvrtdl.supabase.co";
const SB_KEY = process.env.VITE_SUPABASE_ANON_KEY || lerChaveDoEnv();

function lerChaveDoEnv() {
  try {
    const env = fs.readFileSync(path.join(RAIZ, ".env"), "utf8");
    return env.match(/VITE_SUPABASE_ANON_KEY\s*=\s*"?([^"\n\r]+)"?/)?.[1]?.trim() ?? "";
  } catch { return ""; }
}

/* ------------------------------------------------------------------ */
/* leitura do .xlsx (zip + XML, sem dependências)                      */
/* ------------------------------------------------------------------ */

const u32 = (b, o) => b.readUInt32LE(o);
const u16 = (b, o) => b.readUInt16LE(o);

function abrirZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Arquivo não é um .xlsx válido (EOCD não encontrado).");

  const total = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const entradas = new Map();

  for (let i = 0; i < total; i++) {
    if (u32(buf, p) !== 0x02014b50) break;
    const method = u16(buf, p + 10);
    const compressedSize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const offset = u32(buf, p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8");
    entradas.set(name, { method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }

  return (nome) => {
    const e = entradas.get(nome);
    if (!e) return null;
    const nl = u16(buf, e.offset + 26);
    const el = u16(buf, e.offset + 28);
    const inicio = e.offset + 30 + nl + el;
    const cru = buf.slice(inicio, inicio + e.compressedSize);
    const bytes = e.method === 0 ? cru : zlib.inflateRawSync(cru);
    return bytes.toString("utf8");
  };
}

const decodificar = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

function colunaParaIndice(ref) {
  const letras = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Células vazias vêm auto-fechadas (<c r="D3" s="25"/>). Com regex gulosa
 * nos atributos, a barra é consumida e a célula engole as seguintes,
 * deslocando as colunas — foi o que corrompeu a primeira leitura desta
 * planilha. Daí o [^>]*? não-guloso.
 */
function lerAba(xml, textos) {
  const linhas = [];
  const reLinha = /<row[^>]*?>([\s\S]*?)<\/row>/g;
  let l;
  while ((l = reLinha.exec(xml))) {
    const celulas = [];
    const reCel = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let c;
    while ((c = reCel.exec(l[1]))) {
      const attrs = c[1] ?? "";
      const dentro = c[2] ?? "";
      const ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1];
      if (!ref) continue;
      const tipo = attrs.match(/t="([^"]+)"/)?.[1] ?? "n";
      let valor = "";
      if (tipo === "s") {
        const v = dentro.match(/<v>([\s\S]*?)<\/v>/);
        if (v) valor = textos[+v[1]] ?? "";
      } else if (tipo === "inlineStr") {
        let t = "";
        const reT = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let m;
        while ((m = reT.exec(dentro))) t += decodificar(m[1]);
        valor = t;
      } else {
        const v = dentro.match(/<v>([\s\S]*?)<\/v>/);
        if (v) valor = decodificar(v[1]);
      }
      celulas[colunaParaIndice(ref)] = valor;
    }
    linhas.push(celulas);
  }
  return linhas;
}

function planilhaParaObjetos(caminho) {
  const ler = abrirZip(fs.readFileSync(caminho));

  const ss = ler("xl/sharedStrings.xml") ?? "";
  const textos = [];
  const reSi = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = reSi.exec(ss))) {
    let t = "";
    const reT = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let x;
    while ((x = reT.exec(m[1]))) t += decodificar(x[1]);
    textos.push(t);
  }

  const paraObjetos = (grade) => {
    if (!grade.length) return [];
    const cab = grade[0];
    const linhas = [];
    for (let i = 1; i < grade.length; i++) {
      const o = {};
      let vazia = true;
      for (let j = 0; j < cab.length; j++) {
        if (!cab[j]) continue;
        const v = grade[i][j] ?? "";
        o[cab[j]] = v;
        if (v !== "") vazia = false;
      }
      if (!vazia) linhas.push(o);
    }
    return linhas;
  };

  return {
    pessoas: paraObjetos(lerAba(ler("xl/worksheets/sheet1.xml") ?? "", textos)),
    obras: paraObjetos(lerAba(ler("xl/worksheets/sheet2.xml") ?? "", textos)),
  };
}

/* ------------------------------------------------------------------ */
/* normalização — espelha supabase/functions/import-planilha           */
/* ------------------------------------------------------------------ */

const COL = {
  nome: "Nome da Processualista",
  email: "E-mail da Processualista",
  ranking: "Integra Ranking 40+Universidades?",
  universidade: "Se sim, qual Universidade integra?",
  atuacao: "Qual a atuação profissional?",
  uf: "UF da atuação principal",
  ibdp: "É associada do IBDP?",
  abep: "É associada da ABEP?",
  lattes: "Link do currículo Lattes",
  lattesData: "Data da última atualização do Lattes",
  especialista: "É especialista (lato sensu)?",
  mestre: "É mestre?",
  tituloM: "Título da Dissertação de Mestrado",
  anoM: "Ano de publicação da dissertação de Mestrado",
  facM: "Faculdade em que defendeu Mestrado",
  areaM: "Área em que defendeu Mestrado",
  linkM: "Link de acesso ao trabalho (Mestrado)",
  doutora: "É doutora?",
  tituloD: "Título da Tese de Doutorado",
  anoD: "Ano de publicação da tese de Doutorado",
  facD: "Faculdade em que defendeu o Doutorado",
  areaD: "Área em que defendeu o Doutorado",
  linkD: "Link de acesso ao trabalho (Doutorado)",
  livre: "É livre-docente?",
  tituloL: "Título da Tese de Livre-Docência",
  anoL: "Ano de publicação da Tese de Livre-Docência",
  facL: "Faculdade em que defendeu a Livre-Docência",
  areaL: "Área em que defendeu a Livre-Docência",
  linkL: "Link de acesso ao trabalho (Livre-Docência)",
};

const PCOL = {
  nome: "Nome da Processualista",
  tipo: "Tipo de Obra",
  citacao: "Citação completa da Obra",
  ano: "Ano de publicação da Obra",
  area: "Área do Processo",
};

const s = (v) => String(v ?? "").replace(/ /g, " ").trim();
const nn = (v) => { const t = s(v); return t === "" ? null : t; };
const fold = (v) => s(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const chave = (v) => fold(v).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const bool = (v) => ["sim", "s", "true", "1", "yes"].includes(fold(v));

/** id estável e legível na URL; a planilha não traz identificador */
function slug(nome) {
  return chave(nome).replace(/\s+/g, "-").slice(0, 80);
}

function uf(v) {
  const t = s(v);
  const m = t.match(/^([A-Za-z]{2})\s*[—–-]/);
  if (m) return m[1].toUpperCase();
  return /^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : null;
}

function data(v) {
  const t = s(v);
  if (!t) return null;
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  if (/^\d{4,6}$/.test(t)) {
    const n = +t;
    if (n < 20000 || n > 60000) return null;
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return t.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

const ano = (v) => s(v).match(/(19|20)\d{2}/)?.[0] ?? null;

const ATUACAO = {
  "advocacia privada": "Advocacia Privada",
  "advocacia publica": "Advocacia Pública",
  "docencia (exclusivamente)": "Docência (Exclusivamente)",
  "poder judiciario": "Poder Judiciário",
  "ministerio publico": "Ministério Público",
  "defensoria publica": "Defensoria Pública",
  "mediacao / conciliacao": "Mediação / Conciliação",
  "membro de camara arb.": "Membro de Câmara Arb.",
  "outros setores": "Outros Setores",
  "nao localizada": null,
};
const atuacao = (v) => { const f = fold(v); return !f ? null : (f in ATUACAO ? ATUACAO[f] : s(v)); };

function area(v) {
  const f = fold(v);
  if (!f) return "Outros";
  if (f.includes("civil")) return "P. Civil";
  if (f.includes("penal")) return "P. Penal";
  if (f.includes("trabalho") || f.includes("trabalhista")) return "P. Trabalhista";
  if (f.includes("tributario")) return "P. Tributario";
  if (f.includes("constitucional")) return "P. Constitucional";
  if (f.includes("administrativo")) return "P. Administrativo";
  return "Outros";
}

/**
 * Só titulação de direito processual vira obra no portal; direito
 * material ("Direito Civil"...) e área ainda não classificada ficam de
 * fora. Mesma regra de e_processual() no banco.
 */
const eProcessual = (v) => fold(v).startsWith("direito processual");

function tipoObra(v) {
  const f = fold(v);
  if (!f) return "Artigo";
  if (f === "artigo") return "Artigo";
  if (f === "livro") return "Livro";
  if (f.startsWith("capitulo")) return "Capitulo de Livro";
  if (f.startsWith("anais")) return "Anais de Eventos";
  if (f.startsWith("coluna")) return "Coluna em Jornais e Sites";
  if (f.startsWith("org")) return "Org. ou Coord.";
  return "Artigo";
}

/** a planilha usa "Não é público" como marcador, não como endereço */
function link(v) {
  const t = nn(v);
  if (!t) return null;
  return /^n[aã]o\s+[eé]\s+p[uú]blico/i.test(t) ? null : t;
}

/* ------------------------------------------------------------------ */

function montarBase() {
  const { pessoas, obras } = planilhaParaObjetos(PLANILHA);

  const associadas = [];
  const porChave = new Map();
  const avisos = [];

  pessoas.forEach((r, i) => {
    const nome = s(r[COL.nome]);
    if (!nome) { avisos.push({ linha: i + 2, erro: "linha sem nome" }); return; }
    const k = chave(nome);
    if (porChave.has(k)) { avisos.push({ linha: i + 2, erro: "nome repetido", nome }); return; }

    let email = nn(r[COL.email]);
    if (email && (/^n\/?a$/i.test(email) || !email.includes("@"))) email = null;

    const universidade = nn(r[COL.universidade]);
    const a = {
      id: slug(nome),
      nome,
      email,
      uf: uf(r[COL.uf]),
      atuacao: atuacao(r[COL.atuacao]),
      ibdp: bool(r[COL.ibdp]),
      abep: bool(r[COL.abep]),
      // a planilha não tem coluna "Leciona?"; o único sinal é a instituição
      leciona: !!universidade,
      ranking40: bool(r[COL.ranking]),
      instituicao: universidade,
      lattes: nn(r[COL.lattes]),
      lattesAtualizado: data(r[COL.lattesData]),
      especialista: bool(r[COL.especialista]),
      mestre: bool(r[COL.mestre]),
      mestrado: bool(r[COL.mestre]) ? {
        titulo: nn(r[COL.tituloM]), ano: ano(r[COL.anoM]),
        faculdade: nn(r[COL.facM]), area: nn(r[COL.areaM]), link: link(r[COL.linkM]),
      } : null,
      doutora: bool(r[COL.doutora]),
      doutorado: bool(r[COL.doutora]) ? {
        titulo: nn(r[COL.tituloD]), ano: ano(r[COL.anoD]),
        faculdade: nn(r[COL.facD]), area: nn(r[COL.areaD]), link: link(r[COL.linkD]),
      } : null,
      livreDocente: bool(r[COL.livre]),
      livreDocencia: bool(r[COL.livre]) ? {
        titulo: nn(r[COL.tituloL]), ano: ano(r[COL.anoL]),
        faculdade: nn(r[COL.facL]), area: nn(r[COL.areaL]), link: link(r[COL.linkL]),
      } : null,
      incompleto: false,
    };
    porChave.set(k, a);
    associadas.push(a);
  });

  // quem só aparece na aba de bibliografia entra como incompleto, para não
  // perder a obra nem inventar dado
  const producoes = [];
  let descartadas = 0;
  const orfas = new Map();

  for (const r of obras) {
    const nome = s(r[PCOL.nome]);
    const citacao = s(r[PCOL.citacao]);
    if (!nome || !citacao) { descartadas++; continue; }
    const k = chave(nome);
    if (!porChave.has(k) && !orfas.has(k)) orfas.set(k, nome);
    producoes.push({
      autorChave: k,
      tipo: tipoObra(r[PCOL.tipo]),
      citacao,
      ano: ano(r[PCOL.ano]) ?? "s/d",
      area: area(r[PCOL.area]),
    });
  }

  for (const [k, nome] of orfas) {
    const a = {
      id: slug(nome), nome, email: null, uf: null, atuacao: null,
      ibdp: false, abep: false, leciona: false, ranking40: false, instituicao: null,
      lattes: null, lattesAtualizado: null,
      especialista: false, mestre: false, mestrado: null,
      doutora: false, doutorado: null, livreDocente: false, livreDocencia: null,
      incompleto: true,
    };
    porChave.set(k, a);
    associadas.push(a);
  }

  // ids duplicados quebrariam as rotas /consulta/:id
  const vistos = new Map();
  for (const a of associadas) {
    if (vistos.has(a.id)) {
      let n = 2;
      while (vistos.has(`${a.id}-${n}`)) n++;
      a.id = `${a.id}-${n}`;
    }
    vistos.set(a.id, true);
  }

  associadas.sort((x, y) => x.nome.localeCompare(y.nome, "pt-BR"));

  const idPorChave = new Map([...porChave].map(([k, a]) => [k, a.id]));
  const obrasFinais = producoes.map((p, i) => ({
    id: `o${i}`,
    autorId: idPorChave.get(p.autorChave),
    tipo: p.tipo, citacao: p.citacao, ano: p.ano, area: p.area,
    link: null,
    origem: "bibliografia",
  })).filter((o) => o.autorId);

  // Dissertações e teses também são obras, e já estão descritas na aba 1
  // (título, ano, faculdade, área e link). São derivadas daqui em vez de
  // digitadas de novo na aba 2: repetir o dado criaria duas versões do
  // mesmo trabalho, que divergem na primeira correção feita só de um lado.
  const academicas = [];
  const TITULACOES = [
    ["mestrado", "Dissertação de Mestrado", "Dissertação (Mestrado)"],
    ["doutorado", "Tese de Doutorado", "Tese (Doutorado)"],
    ["livreDocencia", "Tese de Livre-Docência", "Tese (Livre-Docência)"],
  ];

  for (const a of associadas) {
    for (const [campo, tipo, mencao] of TITULACOES) {
      const t = a[campo];
      if (!t?.titulo || !eProcessual(t.area)) continue;

      // O nome fica como está na planilha. Inverter para "SOBRENOME, Nome"
      // erra em nome composto e sobrenome estrangeiro, e numa citação
      // acadêmica isso é pior que o formato menos convencional.
      // parte dos campos já vem com pontuação final na planilha; sem
      // aparar, a citação sai com "…, Brasil., 1973."
      const limpar = (v) => String(v ?? "").trim().replace(/[.,;]+$/, "").trim();
      const titulo = limpar(t.titulo);
      const complemento = [limpar(t.faculdade), t.ano].filter(Boolean).join(", ");

      const citacao = complemento
        ? `${a.nome}. ${titulo}. ${mencao} — ${complemento}.`
        : `${a.nome}. ${titulo}. ${mencao}.`;

      academicas.push({
        id: `t${academicas.length}`,
        autorId: a.id,
        tipo,
        citacao,
        ano: t.ano ?? "s/d",
        area: area(t.area),
        link: t.link ?? null,
        origem: "titulacao",
      });
    }
  }

  return {
    associadas,
    obras: [...obrasFinais, ...academicas],
    avisos, descartadas, orfas: orfas.size,
    academicas: academicas.length,
  };
}

/* ------------------------------------------------------------------ */
/* estatísticas — pré-calculadas, para a página não somar 6.800 obras  */
/* ------------------------------------------------------------------ */

function montarEstatisticas(associadas, obras) {
  // Dissertações e teses contam junto com o resto: são espécies de obra,
  // não uma categoria à parte. O total de produções é o total de obras.
  const contar = (itens, chaveDe) => {
    const m = new Map();
    for (const i of itens) {
      const k = chaveDe(i);
      if (k === null || k === undefined || k === "") continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([label, valor]) => ({ label, valor }))
      .sort((a, b) => b.valor - a.valor);
  };

  const total = associadas.length;
  return {
    kpis: {
      total,
      total_producoes: obras.length,
      total_ibdp: associadas.filter((a) => a.ibdp).length,
      total_abep: associadas.filter((a) => a.abep).length,
      total_docentes: associadas.filter((a) => a.leciona).length,
      total_ranking_40: associadas.filter((a) => a.ranking40).length,
      total_doutoras: associadas.filter((a) => a.doutora).length,
      total_mestres: associadas.filter((a) => a.mestre).length,
      total_livre_docentes: associadas.filter((a) => a.livreDocente).length,
      total_especialistas: associadas.filter((a) => a.especialista).length,
    },
    por_uf: contar(associadas, (a) => a.uf),
    por_atuacao: contar(associadas, (a) => a.atuacao),
    por_titulacao: [
      { label: "Mestre", valor: associadas.filter((a) => a.mestre).length },
      { label: "Doutora", valor: associadas.filter((a) => a.doutora).length },
      { label: "Especialista", valor: associadas.filter((a) => a.especialista).length },
      { label: "Livre-Docente", valor: associadas.filter((a) => a.livreDocente).length },
    ].filter((t) => t.valor > 0).sort((a, b) => b.valor - a.valor),
    por_tipo_obra: contar(obras, (o) => o.tipo),
    por_area: contar(obras, (o) => o.area),
    por_ano: contar(obras.filter((o) => /^(19|20)\d{2}$/.test(o.ano)), (o) => o.ano)
      .sort((a, b) => a.label.localeCompare(b.label)),
    por_instituicao: contar(associadas, (a) => a.instituicao).slice(0, 10),
  };
}

/* ------------------------------------------------------------------ */
/* conteúdo institucional — congelado do Supabase                      */
/* ------------------------------------------------------------------ */

function buscarJson(caminho) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SB_URL}/rest/v1/${caminho}`);
    https.get(
      { hostname: url.hostname, path: url.pathname + url.search,
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } },
      (res) => {
        const c = [];
        res.on("data", (x) => c.push(x));
        res.on("end", () => {
          const t = Buffer.concat(c).toString("utf8");
          if (res.statusCode >= 300) return reject(new Error(`${res.statusCode}: ${t.slice(0, 120)}`));
          try { resolve(JSON.parse(t)); } catch (e) { reject(e); }
        });
      }
    ).on("error", reject);
  });
}

async function montarConteudo() {
  const destino = path.join(SAIDA, "conteudo.json");
  if (process.argv.includes("--sem-supabase")) {
    console.log("  conteúdo institucional: mantido (--sem-supabase)");
    return fs.existsSync(destino) ? JSON.parse(fs.readFileSync(destino, "utf8")) : null;
  }
  try {
    const [paginas, membros, grupos] = await Promise.all([
      buscarJson("paginas?select=slug,titulo,subtitulo,conteudo&order=ordem"),
      buscarJson("membros?select=id,nome,funcao,grupo,bio,foto_url,lattes_url,ordem&order=ordem"),
      buscarJson("grupos_membros?select=nome,ordem&order=ordem"),
    ]);
    // Título e subtítulo são texto puro, não passam pelo renderizador de
    // markdown. Como o editor mostra prévia de markdown no corpo, é natural
    // escrever "## Alguma coisa" aqui também — e aí o "##" apareceria
    // literal na página. Some na geração.
    const semMarcacao = (v) =>
      typeof v === "string" ? v.replace(/^\s*#{1,6}\s*/, "").trim() : v;

    const limpas = paginas.map((p) => ({
      ...p,
      titulo: semMarcacao(p.titulo),
      subtitulo: semMarcacao(p.subtitulo),
    }));

    console.log(`  conteúdo institucional: ${limpas.length} páginas, ${membros.length} pessoas`);
    return { paginas: limpas, membros, grupos };
  } catch (e) {
    console.log(`  conteúdo institucional: falhou (${e.message}) — mantendo o arquivo atual`);
    return fs.existsSync(destino) ? JSON.parse(fs.readFileSync(destino, "utf8")) : null;
  }
}

/* ------------------------------------------------------------------ */

async function principal() {
  if (!fs.existsSync(PLANILHA)) {
    console.error(`Planilha não encontrada: ${PLANILHA}`);
    process.exit(1);
  }

  fs.mkdirSync(SAIDA, { recursive: true });
  console.log(`lendo ${path.relative(RAIZ, PLANILHA)}…`);

  const { associadas, obras, avisos, descartadas, orfas, academicas } = montarBase();
  const estat = montarEstatisticas(associadas, obras);
  const conteudo = await montarConteudo();

  const gravar = (nome, dados) => {
    const destino = path.join(SAIDA, nome);
    const txt = JSON.stringify(dados);
    fs.writeFileSync(destino, txt, "utf8");
    const kb = (Buffer.byteLength(txt) / 1024).toFixed(0);
    const gz = (zlib.gzipSync(Buffer.from(txt)).length / 1024).toFixed(0);
    console.log(`  ${nome.padEnd(20)} ${String(kb).padStart(5)} KB  (${gz} KB comprimido)`);
    return destino;
  };

  console.log("\ngravando:");
  // a lista não leva as citações: quem abre a consulta de pessoas não deve
  // baixar 1,2 MB de bibliografia junto
  gravar("associadas.json", associadas);
  gravar("obras.json", obras);
  gravar("estatisticas.json", estat);
  if (conteudo) gravar("conteudo.json", conteudo);

  // arquivos em public/ não recebem hash do Vite: sem um carimbo de versão
  // o navegador continuaria servindo o JSON antigo depois de um deploy
  const versao = Date.now().toString(36);
  fs.writeFileSync(
    path.join(RAIZ, "src", "dadosVersao.ts"),
    `// gerado por scripts/gerar-dados.mjs — não editar à mão\nexport const VERSAO_DADOS = "${versao}";\n`,
    "utf8"
  );
  console.log(`  src/dadosVersao.ts   versão ${versao}`);

  gravar("meta.json", {
    versao,
    geradoEm: new Date().toISOString(),
    origem: path.basename(PLANILHA),
    associadas: associadas.length,
    obras: obras.length,
    obras_academicas: academicas,
    incompletas: associadas.filter((a) => a.incompleto).length,
  });

  console.log(`\n${associadas.length} processualistas · ${obras.length} obras`);
  if (orfas) console.log(`${orfas} vieram só da aba de bibliografia (marcadas como incompletas)`);
  if (descartadas) console.log(`${descartadas} linhas de bibliografia ignoradas (sem nome ou sem citação)`);
  if (avisos.length) {
    console.log(`\navisos (${avisos.length}):`);
    avisos.slice(0, 10).forEach((a) => console.log(`  linha ${a.linha}: ${a.erro}${a.nome ? ` — ${a.nome}` : ""}`));
  }
}

principal().catch((e) => { console.error("FALHOU:", e); process.exit(1); });
