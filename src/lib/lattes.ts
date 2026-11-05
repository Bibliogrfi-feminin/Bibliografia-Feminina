/**
 * Leitura de um currículo Lattes a partir do HTML da página pública
 * (buscatextual.cnpq.br/buscatextual/visualizacv.do).
 *
 * Quem baixa a página é a própria anotadora, no navegador dela, depois de
 * resolver o captcha; o userscript (public/coleta-lattes.user.js) só
 * repassa o HTML ao portal. A extração mora aqui, e não no userscript,
 * para que uma correção valha na hora para todo mundo, sem reinstalar
 * nada.
 *
 * A página não tem marcação semântica: cada seção é um
 * `.title-wrapper` aberto por `<a name="...">`, e cada item é um par de
 * células (`.layout-cell-3` com os anos, `.layout-cell-9` ou
 * `.layout-cell-11` com o texto). Se o CNPq mudar o desenho, é aqui que
 * quebra — e `avisos` diz o que não foi achado, em vez de devolver
 * campos vazios em silêncio.
 */

export const ANO_MINIMO_OBRAS = 2015;

export interface Titulacao {
  /** título do trabalho, sem o "Título:" */
  titulo: string | null;
  /** ano de obtenção (ou o último ano do período, se o texto não disser) */
  ano: string | null;
  /** como o Lattes escreve: "Pontifícia Universidade Católica de Minas Gerais" */
  instituicao: string | null;
  /** "PUC Minas", "USP" — o que a planilha costuma usar */
  sigla: string | null;
}

export interface ObraLattes {
  /** seção do Lattes em que a obra aparece ("Capítulos de livros publicados") */
  secao: string;
  /** sugestão para a coluna "Tipo de Obra"; null quando a seção não diz */
  tipoSugerido: string | null;
  citacao: string;
  ano: string | null;
  /** fora do recorte (antes de 2015, sem ano, ou seção que não é publicação) */
  foraDoRecorte: boolean;
}

export interface CurriculoLattes {
  nome: string | null;
  idLattes: string | null;
  /** dd/mm/aaaa */
  atualizacao: string | null;
  especialista: boolean;
  mestre: boolean;
  mestrado: Titulacao | null;
  doutora: boolean;
  doutorado: Titulacao | null;
  livreDocente: boolean;
  livreDocencia: Titulacao | null;
  /** titulações em andamento, que não contam como SIM mas valem o aviso */
  emAndamento: string[];
  obras: ObraLattes[];
  avisos: string[];
}

/** A página é o currículo mesmo, e não a tela do captcha? */
export function ehPaginaDeCurriculo(doc: Document): boolean {
  return !!doc.querySelector("h2.nome") && !!secao(doc, "FormacaoAcademicaTitulacao", "Identificacao");
}

export function lerCurriculoHtml(html: string): CurriculoLattes {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return lerCurriculo(doc);
}

export function lerCurriculo(doc: Document): CurriculoLattes {
  const avisos: string[] = [];
  const corpo = limpo(doc.body?.textContent ?? "");

  const nome = limpo(doc.querySelector("h2.nome")?.textContent ?? "") || null;
  if (!nome) avisos.push("Nome não encontrado na página.");

  const idLattes = corpo.match(/ID Lattes:?\s*(\d{16})/)?.[1] ?? null;
  if (!idLattes) avisos.push("ID Lattes não encontrado na página.");

  const atualizacao = corpo.match(/Última atualização do currículo em\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1] ?? null;
  if (!atualizacao) avisos.push("Data da última atualização não encontrada.");

  const formacao = lerFormacao(doc, avisos);
  const obras = lerObras(doc, avisos);

  return { nome, idLattes, atualizacao, ...formacao, obras, avisos };
}

// ---------------------------------------------------------------- formação

type Nivel = "especializacao" | "mestrado" | "doutorado" | "livre-docencia";

function nivelDe(primeiraLinha: string): Nivel | null {
  const t = semAcento(primeiraLinha).toLowerCase();
  // a ordem importa: "Pós-Doutorado" contém "doutorado", e "Mestrado
  // Profissional" é mestrado, mas pós-doc não é titulação
  if (/^pos-?doutorado/.test(t)) return null;
  if (/^livre-?docencia/.test(t)) return "livre-docencia";
  if (/^doutorado/.test(t)) return "doutorado";
  if (/^mestrado/.test(t)) return "mestrado";
  if (/^especializacao/.test(t)) return "especializacao";
  return null;
}

function lerFormacao(doc: Document, avisos: string[]) {
  const r = {
    especialista: false, mestre: false, doutora: false, livreDocente: false,
    mestrado: null as Titulacao | null, doutorado: null as Titulacao | null,
    livreDocencia: null as Titulacao | null, emAndamento: [] as string[],
  };

  const sec = secao(doc, "FormacaoAcademicaTitulacao");
  if (!sec) {
    avisos.push("Seção \"Formação acadêmica/titulação\" não encontrada.");
    return r;
  }

  // o Lattes lista da mais recente para a mais antiga: a primeira de cada
  // nível é a que vale
  for (const { anos, texto } of itensDaSecao(sec)) {
    const nivel = nivelDe(texto);
    if (!nivel) continue;

    // "Doutorado em andamento em Direito." / período "2022 - Atual"
    const primeira = texto.split(/\.\s/)[0];
    const andamento = /em andamento/i.test(primeira) || /atual\s*$/i.test(anos);
    if (andamento) {
      r.emAndamento.push(`${primeira} (${anos})`);
      continue;
    }

    const t = titulacao(texto, anos);
    if (nivel === "especializacao") r.especialista = true;
    if (nivel === "mestrado" && !r.mestre) { r.mestre = true; r.mestrado = t; }
    if (nivel === "doutorado" && !r.doutora) { r.doutora = true; r.doutorado = t; }
    if (nivel === "livre-docencia" && !r.livreDocente) { r.livreDocente = true; r.livreDocencia = t; }
  }
  return r;
}

/**
 * O texto de cada titulação vem corrido:
 *   "Doutorado em Direito. Pontifícia Universidade Católica de Minas
 *    Gerais, PUC Minas, Brasil. Título: X, Ano de obtenção: 2020. ..."
 *   "Especialização em Direito. (Carga Horária: 390h). Fundação ..., FESMP, Brasil. Título: ..."
 * A instituição é o trecho entre o nível e o "Título:" (ou o "Ano de
 * obtenção", quando não há título), no formato "Nome, SIGLA, País" ou
 * "Nome, País".
 */
function titulacao(texto: string, anos: string): Titulacao {
  const t = texto.replace(/\(Carga Hor[áa]ria:[^)]*\)\.?/i, "");
  const fimNivel = t.search(/\.\s/);
  const resto = fimNivel >= 0 ? t.slice(fimNivel + 1).trim() : "";

  // a instituição termina no primeiro ". ": depois dele pode vir
  // "com período sanduíche em Max Planck Institute..." antes do título
  const corte = resto.search(/\.\s|T[ií]tulo:|Ano de [Oo]bten[çc][ãa]o|Orientador/);
  const trechoInst = (corte >= 0 ? resto.slice(0, corte) : resto).trim().replace(/\.$/, "");
  const partes = trechoInst.split(",").map(limpo).filter(Boolean);
  if (partes.length > 1) partes.pop(); // país
  const instituicao = partes[0] || null;
  const sigla = partes.length > 1 ? partes[partes.length - 1] : null;

  // "Título: X, Ano de obtenção: 2020. Orientador: Y."
  let titulo: string | null = null;
  const mt = resto.match(/T[ií]tulo:\s*([\s\S]*?)(?:,\s*Ano de [Oo]bten[çc][ãa]o|\.\s*Orientador|\.\s*Bolsista|\.\s*Palavras-chave|\.\s*Grande [áa]rea|$)/);
  if (mt) titulo = limpo(mt[1]).replace(/\.$/, "") || null;

  const ano =
    resto.match(/Ano de [Oo]bten[çc][ãa]o:\s*(\d{4})/)?.[1] ??
    anos.match(/(\d{4})\s*$/)?.[1] ??
    null;

  return { titulo, ano, instituicao, sigla };
}

// ------------------------------------------------------------------ obras

/**
 * Seções da "Produção bibliográfica" e a sugestão de tipo de cada uma.
 * `publicacao: false` fica de fora do recorte por padrão: apresentar um
 * trabalho não é publicá-lo.
 */
const SECOES_OBRAS: { padrao: RegExp; tipo: string | null; publicacao: boolean }[] = [
  { padrao: /^artigos completos publicados/i, tipo: "Artigos (Revista)", publicacao: true },
  { padrao: /^artigos aceitos/i, tipo: "Artigos (Revista)", publicacao: true },
  { padrao: /^livros publicados/i, tipo: "Livros", publicacao: true },
  { padrao: /^cap[ií]tulos de livros/i, tipo: "Capítulo de Livro (Coletânea)", publicacao: true },
  { padrao: /^textos em jornais/i, tipo: "Coluna em Jornais e Sites", publicacao: true },
  { padrao: /^trabalhos completos publicados em anais/i, tipo: "Anais de Eventos", publicacao: true },
  { padrao: /^resumos expandidos/i, tipo: "Anais de Eventos", publicacao: true },
  { padrao: /^resumos publicados em anais/i, tipo: "Anais de Eventos", publicacao: true },
  { padrao: /^outras produ[çc][õo]es bibliogr/i, tipo: null, publicacao: true },
  { padrao: /^pref[áa]cio/i, tipo: null, publicacao: true },
  { padrao: /^tradu[çc][ãa]o/i, tipo: null, publicacao: true },
  { padrao: /^partitura/i, tipo: null, publicacao: false },
  { padrao: /^apresenta[çc][õo]es de trabalho/i, tipo: null, publicacao: false },
];

/** Seções que já são de outro bloco (técnica, artística, demais). */
const FORA_DA_BIBLIOGRAFICA = /t[ée]cnic|art[íi]stic|demais tipos|demais trabalhos/i;

function lerObras(doc: Document, avisos: string[]): ObraLattes[] {
  const sec = secao(doc, "ProducoesCientificas");
  if (!sec) return []; // currículo sem produção nenhuma: a seção some

  const obras: ObraLattes[] = [];
  let atual: { nome: string; tipo: string | null; publicacao: boolean } | null = null;
  let dentroDaBibliografica = false;
  const desconhecidas = new Set<string>();

  // cabeçalhos e itens na ordem do documento
  for (const el of Array.from(sec.querySelectorAll(".inst_back, .cita-artigos, .layout-cell-11"))) {
    if (el.matches(".inst_back")) {
      // "Produção bibliográfica", "Produção técnica", "Demais trabalhos"...
      dentroDaBibliografica = /bibliogr/i.test(el.textContent ?? "");
      atual = null;
      continue;
    }
    if (el.matches(".cita-artigos")) {
      const nome = limpo(el.textContent ?? "");
      // nem sempre há um .inst_back "Produção técnica" antes de
      // "Demais tipos de produção técnica": a própria seção encerra o bloco
      if (FORA_DA_BIBLIOGRAFICA.test(nome)) dentroDaBibliografica = false;
      if (!dentroDaBibliografica) { atual = null; continue; }
      const conhecida = SECOES_OBRAS.find((s) => s.padrao.test(nome));
      if (!conhecida) desconhecidas.add(nome);
      atual = { nome, tipo: conhecida?.tipo ?? null, publicacao: conhecida?.publicacao ?? true };
      continue;
    }
    if (!atual) continue;

    const citacao = citacaoDe(el);
    if (!citacao) continue;
    const ano = el.querySelector('[data-tipo-ordenacao="ano"]')?.textContent?.trim() || anoDaCitacao(citacao);
    obras.push({
      secao: atual.nome,
      tipoSugerido: atual.tipo,
      citacao,
      ano,
      foraDoRecorte: !atual.publicacao || !ano || +ano < ANO_MINIMO_OBRAS,
    });
  }

  for (const n of desconhecidas) avisos.push(`Seção de produção não reconhecida: "${n}" (obras incluídas sem tipo sugerido).`);
  return obras;
}

/** Texto da citação, sem o que a página esconde ou desenha por cima. */
function citacaoDe(el: Element): string {
  const c = el.cloneNode(true) as Element;
  // .informacao-artigo: autor/ano/importância repetidos só para ordenar
  // a lista; .tooltip*: balões do Oasisbr e do JCR; sup: ícones
  c.querySelectorAll(".informacao-artigo, [class*=tooltip], sup, img, script, style, .citado, .citacoes")
    .forEach((x) => x.remove());
  return limpo(c.textContent ?? "")
    // "NAHASS, A. S. L. D. P.. Título": ponto da abreviação + separador
    .replace(/\.\.(?=\s)/g, ".")
    .replace(/\s+([,.;:])/g, "$1");
}

/**
 * Capítulos, livros e anais não trazem o ano marcado: ele vem no meio da
 * referência ("São Paulo: Editora, 2020, v. 1, p. 15-30."). Páginas e
 * volumes saem antes, para que "p. 2019" não vire ano.
 */
export function anoDaCitacao(citacao: string): string | null {
  const limpa = citacao
    .replace(/\bp\.\s*\d+(\s*-\s*\d+)?/gi, "")
    .replace(/\bv\.\s*\d+/gi, "")
    .replace(/\bn\.\s*\d+/gi, "")
    .replace(/\d{4}-\d{3}[\dX]/g, ""); // ISSN
  const limite = new Date().getFullYear() + 1;
  const anos = Array.from(limpa.matchAll(/\b(19\d{2}|20\d{2})\b/g)).map((m) => +m[1]).filter((a) => a <= limite);
  return anos.length ? String(anos[anos.length - 1]) : null;
}

// ------------------------------------------------------------ utilitários

function secao(doc: Document, ...nomes: string[]): Element | null {
  for (const n of nomes) {
    const a = doc.querySelector(`a[name="${n}"]`);
    const w = a?.closest(".title-wrapper");
    if (w) return w;
  }
  return null;
}

/** Pares (anos, texto) de uma seção no formato de duas colunas. */
function itensDaSecao(sec: Element): { anos: string; texto: string }[] {
  const out: { anos: string; texto: string }[] = [];
  for (const y of Array.from(sec.querySelectorAll(".layout-cell-3"))) {
    const t = y.nextElementSibling;
    if (!t) continue;
    const c = t.cloneNode(true) as Element;
    c.querySelectorAll("[class*=tooltip], img, script, style").forEach((x) => x.remove());
    // <br> encosta "Direito.<br>Pontifícia": sem o espaço, as frases colam
    c.querySelectorAll("br").forEach((b) => b.replaceWith(" "));
    out.push({ anos: limpo(y.textContent ?? ""), texto: limpo(c.textContent ?? "") });
  }
  return out;
}

const limpo = (s: string) => s.replace(/\s+/g, " ").trim();
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
