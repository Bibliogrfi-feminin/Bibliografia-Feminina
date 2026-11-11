/**
 * Lotes de coleta do Lattes: planilha de mapeamento (ou a própria base do
 * portal) → fila → currículo lido → revisão → planilha preenchida, ou,
 * no lote da base, titulações gravadas direto em `associadas`.
 *
 * As colunas são achadas pelo NOME do cabeçalho, não pela letra: a
 * Beatriz descreveu tudo em letras (N, O, P...), mas basta alguém inserir
 * uma coluna no meio para as letras andarem. Se um cabeçalho esperado
 * sumir, a leitura da planilha para e diz qual.
 */
import { supabase } from "./supabase";
import { readXlsx } from "../../supabase/functions/import-planilha/xlsx.ts";
import type { CurriculoLattes, Titulacao } from "./lattes";
import { baixarXlsx, type Aba } from "./xlsx";

// ------------------------------------------------------------------ tipos

export type StatusItem = "SEM_LATTES" | "PENDENTE" | "COLETADO" | "REVISADO" | "ERRO";

export interface Lote {
  id: string;
  nome: string;
  arquivo: string | null;
  colunas: string[];
  colunas_obras: string[];
  /** PLANILHA: veio de um .xlsx; BASE: das associadas do portal */
  origem: "PLANILHA" | "BASE";
  criado_em: string;
}

export interface ItemColeta {
  id: string;
  lote_id: string;
  linha: number;
  nome: string;
  lattes_id: string | null;
  link: string | null;
  original: Record<string, string>;
  status: StatusItem;
  coletado: CurriculoLattes | null;
  coletado_em: string | null;
  revisao: Revisao | null;
  revisado_em: string | null;
  erro: string | null;
  /** só no lote da base */
  associada_id: string | null;
}

export interface ObraRevisada {
  citacao: string;
  ano: string;
  secao: string;
  tipoSugerido: string | null;
}

export interface Revisao {
  /** cabeçalho da ABA 1 → valor aprovado */
  campos: Record<string, string>;
  obras: ObraRevisada[];
}

// ---------------------------------------------------------------- colunas

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** campo do currículo → palavras que o cabeçalho precisa conter */
export const CAMPOS = [
  { chave: "atualizacao", rotulo: "Última atualização do Lattes", palavras: ["atualizacao", "lattes"] },
  { chave: "especialista", rotulo: "É especialista?", palavras: ["especialista"] },
  { chave: "mestre", rotulo: "É mestre?", palavras: ["e mestre"] },
  { chave: "titulo_mestrado", rotulo: "Título da dissertação", palavras: ["titulo", "mestrado"] },
  { chave: "ano_mestrado", rotulo: "Ano do mestrado", palavras: ["ano", "mestrado"] },
  { chave: "faculdade_mestrado", rotulo: "Faculdade do mestrado", palavras: ["faculdade", "mestrado"] },
  { chave: "doutora", rotulo: "É doutora?", palavras: ["e doutora"] },
  { chave: "titulo_doutorado", rotulo: "Título da tese", palavras: ["titulo", "doutorado"] },
  { chave: "ano_doutorado", rotulo: "Ano do doutorado", palavras: ["ano", "doutorado"] },
  { chave: "faculdade_doutorado", rotulo: "Faculdade do doutorado", palavras: ["faculdade", "doutorado"] },
  { chave: "livre_docente", rotulo: "É livre-docente?", palavras: ["livre-docente"] },
  { chave: "titulo_livre_docencia", rotulo: "Título da livre-docência", palavras: ["titulo", "livre-docencia"] },
  { chave: "ano_livre_docencia", rotulo: "Ano da livre-docência", palavras: ["ano", "livre-docencia"] },
  { chave: "faculdade_livre_docencia", rotulo: "Faculdade da livre-docência", palavras: ["faculdade", "livre-docencia"] },
] as const;

export type ChaveCampo = (typeof CAMPOS)[number]["chave"];

function acharColuna(colunas: string[], palavras: readonly string[]): string | null {
  return colunas.find((c) => palavras.every((p) => norm(c).includes(p))) ?? null;
}

/** cabeçalho real de cada campo nesta planilha */
export function mapaDeColunas(colunas: string[]) {
  const mapa = {} as Record<ChaveCampo, string>;
  const faltando: string[] = [];
  for (const c of CAMPOS) {
    const col = acharColuna(colunas, c.palavras);
    if (col) mapa[c.chave] = col;
    else faltando.push(c.rotulo);
  }
  return { mapa, faltando };
}

/** A coluna de data vem do Excel como número de série (46301 = 06/10/2026). */
export function exibirValor(coluna: string, valor: string | null | undefined): string {
  const v = (valor ?? "").trim();
  if (/^\d{5}(\.\d+)?$/.test(v) && norm(coluna).includes("data")) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(+v) * 86400000);
    return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
  }
  return v;
}

const idDoLink = (link: string) => link.match(/(\d{16})/)?.[1] ?? null;

// ---------------------------------------------------------------- planilha

export interface PlanilhaLida {
  colunas: string[];
  colunasObras: string[];
  linhas: { linha: number; nome: string; link: string | null; lattesId: string | null; original: Record<string, string> }[];
  /** IDs do Lattes que aparecem em mais de uma linha */
  repetidos: Map<string, string[]>;
}

export async function lerPlanilha(arquivo: File): Promise<PlanilhaLida> {
  const wb = await readXlsx(new Uint8Array(await arquivo.arrayBuffer()), 2);
  const [aba1, aba2] = wb.sheets;
  if (!aba1 || aba1.rows.length === 0) throw new Error("A primeira aba da planilha está vazia.");

  const colunas = Object.keys(aba1.rows[0]);
  const colNome = acharColuna(colunas, ["nome"]);
  const colLink = acharColuna(colunas, ["link", "lattes"]);
  if (!colNome) throw new Error("Não achei a coluna do nome na ABA 1.");
  if (!colLink) throw new Error("Não achei a coluna \"Link do currículo Lattes\" na ABA 1.");
  const { faltando } = mapaDeColunas(colunas);
  if (faltando.length) throw new Error(`Faltam colunas na ABA 1: ${faltando.join(", ")}.`);

  const colunasObras = aba2?.rows.length ? Object.keys(aba2.rows[0]) : PADRAO_ABA2;
  // a ABA 2 chega vazia (só cabeçalho), e aí readXlsx não tem linha para
  // tirar as chaves; o cabeçalho da planilha da Beatriz é o padrão
  const linhas = aba1.rows
    .map((original, i) => {
      const nome = (original[colNome] ?? "").trim();
      const link = (original[colLink] ?? "").trim() || null;
      return { linha: i + 2, nome, link, lattesId: link ? idDoLink(link) : null, original };
    })
    .filter((l) => l.nome);

  const porId = new Map<string, string[]>();
  for (const l of linhas) if (l.lattesId) porId.set(l.lattesId, [...(porId.get(l.lattesId) ?? []), l.nome]);
  const repetidos = new Map([...porId].filter(([, nomes]) => nomes.length > 1));

  return { colunas, colunasObras, linhas, repetidos };
}

const PADRAO_ABA2 = [
  "Nome da Processualista", "Tipo de Obra", "Citação completa da Obra", "Ano de publicação da Obra",
  "Área do Processo", "Obra física ou eletrônica?", "Se eletrônica, pública ou protegida?",
  "Se física, localização", "Se eletrônica protegida, localização",
  "Se eletrônica pública, link de acesso ao trabalho",
];

// ------------------------------------------------------- lote da base

/**
 * O lote da base não tem planilha: monta uma "linha" por associada com os
 * mesmos cabeçalhos da planilha da Beatriz, para que revisão, siglas e
 * exportação funcionem sem caminho à parte. `db` é a coluna de
 * `associadas` por trás de cada cabeçalho.
 */
const COLUNAS_BASE: { cabecalho: string; db: string; tipo: "texto" | "bool" | "data" }[] = [
  { cabecalho: "Nome da Processualista", db: "nome", tipo: "texto" },
  { cabecalho: "Link do currículo Lattes", db: "link_lattes", tipo: "texto" },
  { cabecalho: "Data da última atualização do Lattes", db: "data_atualizacao_lattes", tipo: "data" },
  { cabecalho: "É especialista (lato sensu)?", db: "especialista", tipo: "bool" },
  { cabecalho: "É mestre?", db: "mestre", tipo: "bool" },
  { cabecalho: "Título da Dissertação de Mestrado", db: "titulo_mestrado", tipo: "texto" },
  { cabecalho: "Ano de publicação da dissertação de Mestrado", db: "ano_mestrado", tipo: "texto" },
  { cabecalho: "Faculdade em que defendeu Mestrado", db: "faculdade_mestrado", tipo: "texto" },
  { cabecalho: "É doutora?", db: "doutora", tipo: "bool" },
  { cabecalho: "Título da Tese de Doutorado", db: "titulo_doutorado", tipo: "texto" },
  { cabecalho: "Ano de publicação da tese de Doutorado", db: "ano_doutorado", tipo: "texto" },
  { cabecalho: "Faculdade em que defendeu o Doutorado", db: "faculdade_doutorado", tipo: "texto" },
  { cabecalho: "É livre-docente?", db: "livre_docente", tipo: "bool" },
  { cabecalho: "Título da Tese de Livre-Docência", db: "titulo_livre_docencia", tipo: "texto" },
  { cabecalho: "Ano de publicação da Tese de Livre-Docência", db: "ano_livre_docencia", tipo: "texto" },
  { cabecalho: "Faculdade em que defendeu a Livre-Docência", db: "faculdade_livre_docencia", tipo: "texto" },
];

/** campos de titulação: mexeu em algum, as obras derivadas são refeitas */
const DB_TITULACAO = new Set(COLUNAS_BASE.filter((c) => /mestr|doutor|docen/.test(c.db)).map((c) => c.db));

const paraLinha = (a: Record<string, any>): Record<string, string> =>
  Object.fromEntries(COLUNAS_BASE.map((c) => {
    const v = a[c.db];
    if (c.tipo === "bool") return [c.cabecalho, v ? "Sim" : "Não"];
    if (c.tipo === "data") return [c.cabecalho, v ? String(v).slice(0, 10).split("-").reverse().join("/") : ""];
    return [c.cabecalho, v == null ? "" : String(v)];
  }));

async function associadasAtivas() {
  const cols = ["id", ...COLUNAS_BASE.map((c) => c.db)].join(",");
  return todos<Record<string, any>>((de, ate) =>
    supabase.from("associadas").select(cols).is("deletado_em", null).order("nome").range(de, ate)
  );
}

/** Quantas pessoas da base têm link do Lattes (para o botão de criar). */
export async function contarBase(): Promise<{ total: number; comLattes: number }> {
  const as = await associadasAtivas();
  return { total: as.length, comLattes: as.filter((a) => idDoLink(a.link_lattes ?? "")).length };
}

export async function criarLoteDaBase(nome: string): Promise<Lote> {
  const as = await associadasAtivas();
  const { data: lote, error } = await supabase
    .from("coleta_lotes")
    .insert({ nome, arquivo: null, origem: "BASE", colunas: COLUNAS_BASE.map((c) => c.cabecalho), colunas_obras: PADRAO_ABA2 })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const itens = as.map((a, i) => {
    const lattesId = idDoLink(a.link_lattes ?? "");
    return {
      lote_id: lote.id,
      linha: i + 2,
      nome: a.nome,
      link: a.link_lattes ?? null,
      lattes_id: lattesId,
      associada_id: a.id,
      original: paraLinha(a),
      status: lattesId ? "PENDENTE" : "SEM_LATTES",
    };
  });
  for (let i = 0; i < itens.length; i += 500) {
    const { error: e } = await supabase.from("coleta_itens").insert(itens.slice(i, i + 500));
    if (e) {
      await supabase.from("coleta_lotes").delete().eq("id", lote.id);
      throw new Error(`Erro ao gravar as linhas: ${e.message}`);
    }
  }
  return lote as Lote;
}

/**
 * Grava na ficha da pessoa o que a revisão aprovou. O RLS barra o UPDATE
 * sem erro (só não acha linha), então a falta de linha devolvida vira erro
 * aqui — senão a revisão ficaria "aprovada" sem nada ter mudado.
 */
export async function aplicarNaBase(item: ItemColeta, revisao: Revisao) {
  if (!item.associada_id) throw new Error("Este item não está ligado a ninguém da base.");
  const patch: Record<string, unknown> = {};
  for (const [cabecalho, valor] of Object.entries(revisao.campos)) {
    const c = COLUNAS_BASE.find((x) => x.cabecalho === cabecalho);
    if (!c || c.db === "nome" || c.db === "link_lattes") continue;
    const v = valor.trim();
    if (c.tipo === "bool") patch[c.db] = norm(v) === "sim";
    else if (c.tipo === "data") {
      const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) patch[c.db] = `${m[3]}-${m[2]}-${m[1]}`;
    } else patch[c.db] = !v || v === "N/A" ? null : v;
  }
  if (Object.keys(patch).length === 0) return;

  const { data, error } = await supabase.from("associadas").update(patch).eq("id", item.associada_id).select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("O portal não deixou gravar nesta ficha (sem permissão ou registro excluído).");

  if (Object.keys(patch).some((k) => DB_TITULACAO.has(k))) {
    const { error: e } = await supabase.rpc("sincronizar_titulacao_de", { p_associada: item.associada_id });
    if (e) throw new Error(`Titulação gravada, mas as teses da ficha não foram refeitas: ${e.message}`);
  }
}

/**
 * A obra do Lattes já está no portal? As citações da base também vieram
 * do Lattes (ou de algo parecido), então basta comparar as palavras: se
 * quase todas as palavras da menor citação estão na outra, é a mesma obra.
 */
const palavras = (s: string) => new Set(norm(s).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length >= 4));

export function mesmaObra(a: string, b: string): boolean {
  const A = palavras(a), B = palavras(b);
  const menor = Math.min(A.size, B.size);
  if (menor < 4) return false;
  let comum = 0;
  for (const w of A) if (B.has(w)) comum++;
  return comum / menor >= 0.75;
}

async function marcarObrasNaBase(cv: CurriculoLattes, associadaId: string) {
  const { data, error } = await supabase
    .from("producoes_bibliograficas")
    .select("citacao_completa")
    .eq("associada_id", associadaId)
    .not("tipo_obra", "in", '("Dissertação de Mestrado","Tese de Doutorado","Tese de Livre-Docência")');
  if (error) throw new Error(error.message);
  const existentes = (data ?? []).map((d) => d.citacao_completa as string);
  for (const o of cv.obras) o.jaNaBase = existentes.some((e) => mesmaObra(o.citacao, e));
}

// ------------------------------------------------------------------ banco

/** PostgREST devolve no máximo 1000 linhas por vez. */
async function todos<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: any }>) {
  const out: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function criarLote(nome: string, arquivo: string, p: PlanilhaLida): Promise<Lote> {
  const { data: lote, error } = await supabase
    .from("coleta_lotes")
    .insert({ nome, arquivo, colunas: p.colunas, colunas_obras: p.colunasObras })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const itens = p.linhas.map((l) => ({
    lote_id: lote.id,
    linha: l.linha,
    nome: l.nome,
    link: l.link,
    lattes_id: l.lattesId,
    original: l.original,
    status: l.lattesId ? "PENDENTE" : "SEM_LATTES",
  }));
  for (let i = 0; i < itens.length; i += 500) {
    const { error: e } = await supabase.from("coleta_itens").insert(itens.slice(i, i + 500));
    if (e) {
      // sem transação no cliente: não deixa lote pela metade para trás
      await supabase.from("coleta_lotes").delete().eq("id", lote.id);
      throw new Error(`Erro ao gravar as linhas: ${e.message}`);
    }
  }
  return lote as Lote;
}

export async function listarLotes(): Promise<Lote[]> {
  const { data, error } = await supabase.from("coleta_lotes").select("*").order("criado_em", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Lote[];
}

export async function apagarLote(id: string) {
  const { error } = await supabase.from("coleta_lotes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listarItens(loteId: string): Promise<ItemColeta[]> {
  return todos<ItemColeta>((de, ate) =>
    supabase.from("coleta_itens").select("*").eq("lote_id", loteId).order("linha").range(de, ate)
  );
}

/** Próximo da fila, já reservado; null quando a fila acabou. */
export async function proximoDaFila(loteId: string, pular?: string): Promise<ItemColeta | null> {
  const { data, error } = await supabase.rpc("coleta_proximo", { p_lote: loteId, p_pular: pular ?? null });
  if (error) throw new Error(error.message);
  // função que devolve um tipo composto vazio chega como objeto de nulos
  return data && (data as ItemColeta).id ? (data as ItemColeta) : null;
}

export async function gravarColeta(item: ItemColeta, cv: CurriculoLattes): Promise<ItemColeta> {
  const avisos = [...cv.avisos];
  if (cv.idLattes && item.lattes_id && cv.idLattes !== item.lattes_id) {
    avisos.unshift(`O currículo aberto (ID ${cv.idLattes}) não é o do link da planilha (ID ${item.lattes_id}).`);
  }
  if (item.associada_id) await marcarObrasNaBase(cv, item.associada_id);
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("coleta_itens")
    .update({
      status: "COLETADO",
      coletado: { ...cv, avisos },
      coletado_por: user?.id ?? null,
      coletado_em: new Date().toISOString(),
      erro: null,
      reservado_por: null,
      reservado_em: null,
      // coletar de novo invalida a revisão anterior
      revisao: null,
      revisado_por: null,
      revisado_em: null,
    })
    .eq("id", item.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ItemColeta;
}

export async function marcarErro(item: ItemColeta, erro: string) {
  const { error } = await supabase
    .from("coleta_itens")
    .update({ status: "ERRO", erro, reservado_por: null, reservado_em: null })
    .eq("id", item.id);
  if (error) throw new Error(error.message);
}

export async function salvarRevisao(item: ItemColeta, revisao: Revisao): Promise<ItemColeta> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("coleta_itens")
    .update({ status: "REVISADO", revisao, revisado_por: user?.id ?? null, revisado_em: new Date().toISOString() })
    .eq("id", item.id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as ItemColeta;
}

// ---------------------------------------------------------------- revisão

// ----------------------------------------------------------------- siglas

/** "de" → "para"; a chave já passou por chaveSigla */
export type Siglas = Map<string, string>;

/**
 * "PUC-SP", "PUC/SP", "pucsp" e "PUC SP" viram a mesma chave. Igual à
 * restrição da coluna `de` em coleta_siglas: só A-Z e 0-9.
 */
export const chaveSigla = (s: string | null | undefined) =>
  norm(s).toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function listarSiglas(): Promise<Siglas> {
  const { data, error } = await supabase.from("coleta_siglas").select("de,para").order("de");
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((r) => [r.de, r.para]));
}

export async function salvarSigla(de: string, para: string) {
  const chave = chaveSigla(de);
  if (!chave || !para.trim()) throw new Error("Preencha as duas siglas.");
  const { error } = await supabase.from("coleta_siglas").upsert({ de: chave, para: para.trim() });
  if (error) throw new Error(error.message);
}

export async function apagarSigla(de: string) {
  const { error } = await supabase.from("coleta_siglas").delete().eq("de", de);
  if (error) throw new Error(error.message);
}

/** Instituição como o Lattes escreve (a sigla, ou o nome quando não há). */
export const instituicaoBruta = (t: Titulacao | null) => t?.sigla ?? t?.instituicao ?? "";

/** Instituição no padrão da planilha: tenta a sigla, depois o nome. */
export function traduzirInstituicao(t: Titulacao | null, siglas: Siglas): string {
  if (!t) return "";
  return siglas.get(chaveSigla(t.sigla)) ?? siglas.get(chaveSigla(t.instituicao)) ?? instituicaoBruta(t);
}

const simNao = (b: boolean) => (b ? "Sim" : "Não");

/** O que o currículo diz para cada campo da ABA 1. */
export function valoresDoLattes(cv: CurriculoLattes, siglas: Siglas = new Map()): Record<ChaveCampo, string> {
  const tit = (ok: boolean, t: Titulacao | null) => ({
    titulo: ok ? t?.titulo ?? "" : "N/A",
    ano: ok ? t?.ano ?? "" : "N/A",
    faculdade: ok ? traduzirInstituicao(t, siglas) : "N/A",
  });
  const m = tit(cv.mestre, cv.mestrado);
  const d = tit(cv.doutora, cv.doutorado);
  const l = tit(cv.livreDocente, cv.livreDocencia);
  return {
    atualizacao: cv.atualizacao ?? "",
    especialista: simNao(cv.especialista),
    mestre: simNao(cv.mestre),
    titulo_mestrado: m.titulo, ano_mestrado: m.ano, faculdade_mestrado: m.faculdade,
    doutora: simNao(cv.doutora),
    titulo_doutorado: d.titulo, ano_doutorado: d.ano, faculdade_doutorado: d.faculdade,
    livre_docente: simNao(cv.livreDocente),
    titulo_livre_docencia: l.titulo, ano_livre_docencia: l.ano, faculdade_livre_docencia: l.faculdade,
  };
}

export interface CampoProposto {
  chave: ChaveCampo;
  rotulo: string;
  coluna: string;
  atual: string;
  lattes: string;
  /** "vazio": a planilha não tinha nada; "igual"; "diferente": conflito */
  situacao: "vazio" | "igual" | "diferente";
  /** marcado por padrão? */
  usar: boolean;
  /** faculdade: como o Lattes escreve, antes da tabela de siglas */
  bruto?: string;
}

const FACULDADES: Record<string, keyof CurriculoLattes> = {
  faculdade_mestrado: "mestrado",
  faculdade_doutorado: "doutorado",
  faculdade_livre_docencia: "livreDocencia",
};

/** Campo a campo, o que muda — e o que muda sozinho sem perguntar. */
/**
 * `daBase`: no lote da base, especialista/mestre/doutora/livre-docente
 * nascem "Não" no cadastro e podem só não ter sido preenchidos — um "Sim"
 * do Lattes entra como se o campo estivesse vazio. E "N/A" contra campo
 * vazio é a mesma coisa: a base guarda a ausência como vazio.
 */
export function propostaDeCampos(
  item: ItemColeta, colunas: string[], siglas: Siglas = new Map(), daBase = false,
): CampoProposto[] {
  const cv = item.coletado;
  if (!cv) return [];
  const { mapa } = mapaDeColunas(colunas);
  const lattes = valoresDoLattes(cv, siglas);
  return CAMPOS.filter((c) => mapa[c.chave]).map((c) => {
    const coluna = mapa[c.chave];
    const atual = exibirValor(coluna, item.original[coluna]);
    const valor = lattes[c.chave];
    const tit = FACULDADES[c.chave] ? (cv[FACULDADES[c.chave]] as Titulacao | null) : null;
    const bruto = tit ? instituicaoBruta(tit) : undefined;

    let igual = norm(atual) === norm(valor);
    if (!igual && bruto !== undefined) {
      // "PUCSP" na planilha e "PUC/SP" no Lattes são a mesma coisa; e a
      // planilha também pode estar numa grafia que a tabela traduz
      const ca = chaveSigla(atual);
      igual = ca === chaveSigla(valor) || (siglas.get(ca) ?? null) === valor;
    }
    const naAusente = daBase && valor === "N/A" && !atual;
    const naoFraco = daBase && atual === "Não" && valor === "Sim";
    const situacao = naAusente ? "igual" : !atual || naoFraco ? "vazio" : igual ? "igual" : "diferente";
    // a data do Lattes é sempre a mais nova; o resto só entra sozinho
    // onde a planilha estava em branco
    const usar = !!valor && (situacao === "vazio" || (c.chave === "atualizacao" && situacao === "diferente"));
    return { chave: c.chave, rotulo: c.rotulo, coluna, atual, lattes: valor, situacao, usar, bruto };
  });
}

export function obrasPropostas(item: ItemColeta) {
  return (item.coletado?.obras ?? []).map((o) => ({ ...o, usar: !o.foraDoRecorte && !o.jaNaBase }));
}

/** Há algo que pede decisão humana? Sem isso, dá para aprovar em lote. */
export function temConflito(item: ItemColeta, colunas: string[], siglas?: Siglas, daBase = false): boolean {
  if (!item.coletado) return false;
  if (item.coletado.avisos.length) return true;
  return propostaDeCampos(item, colunas, siglas, daBase).some((c) => c.situacao === "diferente" && c.chave !== "atualizacao");
}

export function revisaoPadrao(item: ItemColeta, colunas: string[], siglas?: Siglas, daBase = false): Revisao {
  const campos: Record<string, string> = {};
  for (const c of propostaDeCampos(item, colunas, siglas, daBase)) if (c.usar) campos[c.coluna] = c.lattes;
  const obras = obrasPropostas(item)
    .filter((o) => o.usar)
    .map((o) => ({ citacao: o.citacao, ano: o.ano ?? "", secao: o.secao, tipoSugerido: o.tipoSugerido }));
  return { campos, obras };
}

// --------------------------------------------------------------- exportar

/**
 * A ABA 1 sai com as mesmas linhas, na mesma ordem e com as mesmas
 * colunas da planilha enviada — dá para colar o bloco de colunas de volta
 * na planilha mestra. Só entra o que foi REVISADO.
 */
export async function exportarLote(lote: Lote, itens: ItemColeta[]) {
  const base = (lote.arquivo ?? lote.nome).replace(/\.xlsx$/i, "");
  await baixarXlsx(`${base} - coleta Lattes.xlsx`, abasDoLote(lote, itens));
}

export function abasDoLote(lote: Lote, itens: ItemColeta[]): Aba[] {
  const { mapa } = mapaDeColunas(lote.colunas);
  const colunaData = mapa.atualizacao;
  const colNome = acharColuna(lote.colunas, ["nome"])!;

  const ordenados = [...itens].sort((a, b) => a.linha - b.linha);
  const aba1 = ordenados.map((it) =>
    lote.colunas.map((c) => {
      const aprovado = it.status === "REVISADO" ? it.revisao?.campos[c] : undefined;
      if (aprovado !== undefined) return aprovado;
      return c === colunaData ? exibirValor(c, it.original[c]) : it.original[c] ?? "";
    })
  );

  const cNome = lote.colunas_obras.findIndex((c) => norm(c).startsWith("nome"));
  const cCit = lote.colunas_obras.findIndex((c) => norm(c).includes("citacao"));
  const cAno = lote.colunas_obras.findIndex((c) => norm(c).startsWith("ano"));
  const aba2: string[][] = [];
  for (const it of ordenados) {
    if (it.status !== "REVISADO" || !it.revisao) continue;
    for (const o of it.revisao.obras) {
      const linha = lote.colunas_obras.map(() => "");
      // o nome exatamente como está na ABA 1, para as abas casarem
      if (cNome >= 0) linha[cNome] = it.original[colNome] ?? it.nome;
      if (cCit >= 0) linha[cCit] = o.citacao;
      if (cAno >= 0) linha[cAno] = o.ano;
      aba2.push(linha);
    }
  }

  return [
    { nome: "ABA 1 - Dados", colunas: lote.colunas, linhas: aba1 },
    { nome: "ABA 2 - Produção Bibliográfica", colunas: lote.colunas_obras, linhas: aba2 },
  ];
}
