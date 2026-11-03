import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Search, Download, ChevronRight, X } from "lucide-react";
import { baixarXlsx, baixarCsv, deRegistros } from "../lib/xlsx";
import { getAssociadas, getObras, Associada, Obra, semAcento } from "../lib/base";
import { BuscaObras } from "../components/BuscaObras";
import { Chip, Paginacao, ROTULO_FILTRO, SELECT_CHIP } from "../components/ConsultaUI";

const POR_PAGINA = 15;

const TITULACOES = [
  { id: "", rotulo: "Todas" },
  { id: "livre_docente", rotulo: "Livre-docente" },
  { id: "doutora", rotulo: "Doutora" },
  { id: "mestre", rotulo: "Mestre" },
  { id: "especialista", rotulo: "Especialista" },
] as const;

/**
 * Ligado, o chip mostra só quem tem; desligado, não filtra. O "só quem NÃO
 * é do IBDP" dos antigos seletores Sim/Não saiu: quase ninguém o usava, e
 * cinco seletores iguais pesavam mais que a própria busca.
 */
const FLAGS = [
  { id: "ibdp", rotulo: "IBDP", tem: (a: Associada) => a.ibdp },
  { id: "abep", rotulo: "ABEP", tem: (a: Associada) => a.abep },
  { id: "docente", rotulo: "Docente", tem: (a: Associada) => a.leciona },
  { id: "ranking", rotulo: "Ranking 40+", tem: (a: Associada) => a.ranking40 },
] as const;

type IdFlag = (typeof FLAGS)[number]["id"];

/**
 * Consulta de pessoas.
 *
 * A lista inteira são 66 KB comprimidos, então filtrar e paginar no
 * navegador sai mais rápido do que ir ao servidor a cada tecla.
 */
const BuscaPessoas = () => {
  const [todas, setTodas] = useState<Associada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [uf, setUf] = useState("");
  const [flags, setFlags] = useState<Set<IdFlag>>(new Set());
  const [formacao, setFormacao] = useState("");
  const topoResultados = useRef<HTMLDivElement>(null);

  /**
   * A busca também alcança o conteúdo das obras: quem procura "coisa
   * julgada" quer as autoras que escreveram sobre isso, não só quem tem
   * essas palavras no nome.
   *
   * A bibliografia pesa bem mais que a lista de pessoas, então só é
   * baixada quando alguém realmente busca — e uma vez só. Até ela chegar,
   * a busca por nome já responde.
   */
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [buscandoObras, setBuscandoObras] = useState(false);

  useEffect(() => {
    getAssociadas()
      .then(setTodas)
      .catch(() => setErro("Não foi possível carregar a base."))
      .finally(() => setCarregando(false));
  }, []);

  useEffect(() => {
    if (busca.trim().length < 3 || obras || buscandoObras) return;
    setBuscandoObras(true);
    getObras()
      .then(setObras)
      .catch(() => setObras([]))
      .finally(() => setBuscandoObras(false));
  }, [busca, obras, buscandoObras]);

  /** quantas obras de cada autora casam com o termo */
  const acertosPorAutora = useMemo(() => {
    const termo = semAcento(busca.trim());
    const m = new Map<string, number>();
    if (!termo || !obras) return m;
    for (const o of obras) {
      if (semAcento(o.citacao).includes(termo)) {
        m.set(o.autorId, (m.get(o.autorId) ?? 0) + 1);
      }
    }
    return m;
  }, [obras, busca]);

  /** só os estados que existem na base, em vez de um campo de texto livre */
  const ufs = useMemo(
    () => [...new Set(todas.map((a) => (a.uf ?? "").toUpperCase()).filter(Boolean))].sort(),
    [todas]
  );

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    return todas.filter((a) => {
      if (termo) {
        const alvo = semAcento(`${a.nome} ${a.email ?? ""} ${a.instituicao ?? ""}`);
        // entra por dado próprio ou por ter obra sobre o assunto
        if (!alvo.includes(termo) && !acertosPorAutora.has(a.id)) return false;
      }
      if (uf && (a.uf ?? "").toUpperCase() !== uf) return false;
      for (const f of FLAGS) if (flags.has(f.id) && !f.tem(a)) return false;
      if (formacao === "doutora" && !a.doutora) return false;
      if (formacao === "mestre" && !a.mestre) return false;
      if (formacao === "especialista" && !a.especialista) return false;
      if (formacao === "livre_docente" && !a.livreDocente) return false;
      return true;
    });
  }, [todas, busca, uf, flags, formacao, acertosPorAutora]);

  // qualquer mudança de critério volta para a primeira página
  useEffect(() => { setPagina(1); }, [busca, uf, flags, formacao]);

  const paginas = Math.ceil(filtradas.length / POR_PAGINA) || 1;
  const visiveis = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const temFiltro = Boolean(busca || uf || flags.size || formacao);

  const alternarFlag = (id: IdFlag) =>
    setFlags((atual) => {
      const novo = new Set(atual);
      novo.has(id) ? novo.delete(id) : novo.add(id);
      return novo;
    });

  const limpar = () => { setBusca(""); setUf(""); setFlags(new Set()); setFormacao(""); };

  const irParaPagina = (n: number) => {
    setPagina(n);
    topoResultados.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const exportar = async (formato: "csv" | "xlsx") => {
    if (filtradas.length === 0) { alert("Nenhum dado para exportar"); return; }
    const linhas = filtradas.map((a) => ({
      Nome: a.nome,
      Email: a.email ?? "",
      UF: a.uf ?? "",
      "Atuação": a.atuacao ?? "",
      IBDP: a.ibdp ? "Sim" : "Não",
      ABEP: a.abep ? "Sim" : "Não",
      Leciona: a.leciona ? "Sim" : "Não",
      "Instituição": a.instituicao ?? "",
      "Ranking 40+": a.ranking40 ? "Sim" : "Não",
      Especialista: a.especialista ? "Sim" : "Não",
      Mestre: a.mestre ? "Sim" : "Não",
      "Título do Mestrado": a.mestrado?.titulo ?? "",
      Doutora: a.doutora ? "Sim" : "Não",
      "Título do Doutorado": a.doutorado?.titulo ?? "",
      "Livre-Docente": a.livreDocente ? "Sim" : "Não",
      Lattes: a.lattes ?? "",
    }));

    const tabela = deRegistros(linhas);
    if (formato === "csv") {
      baixarCsv("processualistas.csv", tabela);
    } else {
      await baixarXlsx("processualistas.xlsx", [{ nome: "Processualistas", ...tabela }]);
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => e.preventDefault()} className="bg-white p-5 md:p-6 rounded-xl border border-[var(--border)] space-y-5">
        <div>
          <div className="relative">
            <Search className="w-5 h-5 text-[var(--text-muted)] absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              aria-label="Buscar processualistas"
              placeholder="Nome, instituição ou tema de uma obra…"
              className="w-full pl-12 pr-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[15px] focus:bg-white focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <p className="text-[12px] text-[var(--text-muted)] mt-2 min-h-4">
            {buscandoObras
              ? "Buscando também nas obras…"
              : busca.trim().length >= 3 && acertosPorAutora.size > 0
              ? `${acertosPorAutora.size} ${acertosPorAutora.size === 1 ? "autora escreveu" : "autoras escreveram"} sobre isso.`
              : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`${ROTULO_FILTRO} mr-1 w-full sm:w-auto`}>Titulação</span>
          {TITULACOES.map((t) => (
            <Chip key={t.id} ativo={formacao === t.id} onClick={() => setFormacao(t.id)}>{t.rotulo}</Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className={`${ROTULO_FILTRO} mr-1 w-full sm:w-auto`}>Mostrar só</span>
          {FLAGS.map((f) => (
            <Chip key={f.id} ativo={flags.has(f.id)} onClick={() => alternarFlag(f.id)}>{f.rotulo}</Chip>
          ))}
          <label className="flex items-center gap-2 sm:ml-3">
            <span className={ROTULO_FILTRO}>UF</span>
            <select
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              className={SELECT_CHIP}
            >
              <option value="">Todas</option>
              {ufs.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>
          {temFiltro && (
            <button
              type="button"
              onClick={limpar}
              className="ml-auto inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accent)] hover:text-[var(--heading)]"
            >
              <X className="w-4 h-4" /> Limpar filtros
            </button>
          )}
        </div>
      </form>

      {/* scroll-mt: ao trocar de página, a lista para abaixo da barra de navegação */}
      <div ref={topoResultados} className="scroll-mt-24 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text-main)] tabular-nums">{filtradas.length.toLocaleString("pt-BR")}</span>{" "}
          {filtradas.length === 1 ? "processualista" : "processualistas"}
          {filtradas.length !== todas.length && ` de ${todas.length.toLocaleString("pt-BR")}`}
        </p>
        <div className="flex items-center gap-1 text-[13px]">
          <span className="text-[var(--text-muted)] mr-1">Exportar</span>
          {(["csv", "xlsx"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => exportar(f)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-semibold text-[var(--accent)] hover:bg-[var(--nav-active)]"
            >
              <Download className="w-3.5 h-3.5" /> {f === "csv" ? "CSV" : "Excel"}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        {carregando ? (
          <p className="text-center py-12 text-[var(--text-muted)]">Carregando…</p>
        ) : erro ? (
          <p className="text-center py-12 text-[var(--error)]">{erro}</p>
        ) : visiveis.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--text-muted)]">Nenhuma processualista encontrada.</p>
            {temFiltro && (
              <button type="button" onClick={limpar} className="mt-3 text-[13px] font-semibold text-[var(--accent)] hover:text-[var(--heading)]">
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {visiveis.map((a) => {
              const titulos = [a.livreDocente && "Livre-docente", a.doutora && "Doutora", a.mestre && "Mestre", a.especialista && "Especialista"]
                .filter(Boolean) as string[];
              const entidades = [a.ibdp && "IBDP", a.abep && "ABEP", a.ranking40 && "Ranking 40+"].filter(Boolean) as string[];
              const obrasAchadas = acertosPorAutora.get(a.id);
              return (
                <li key={a.id}>
                  {/* um link de verdade: Ctrl+clique abre a ficha em outra aba */}
                  <Link
                    to={`/consulta/${a.id}`}
                    className="group flex items-center gap-4 px-5 py-4 hover:bg-[var(--row-hover)] transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:-outline-offset-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-[15px] text-[var(--text-main)] group-hover:text-[var(--accent)]">{a.nome}</span>
                        {a.incompleto && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--warning-bg)] text-[var(--warning)] font-bold uppercase">
                            incompleto
                          </span>
                        )}
                        {/* diz por que a pessoa apareceu quando o termo não
                            está no nome dela, mas nas obras que escreveu */}
                        {obrasAchadas && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--highlight-bg)] text-[var(--highlight)] font-bold uppercase whitespace-nowrap">
                            {obrasAchadas} {obrasAchadas === 1 ? "obra" : "obras"} sobre o tema
                          </span>
                        )}
                      </div>
                      <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
                        {[a.atuacao, a.uf].filter(Boolean).join(" · ") || "Atuação não informada"}
                      </p>
                      {(titulos.length > 0 || entidades.length > 0) && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          {titulos.map((t) => (
                            <span key={t} className="px-2 py-0.5 rounded text-[11px] font-semibold bg-[var(--nav-active)] text-[var(--accent)]">{t}</span>
                          ))}
                          {entidades.length > 0 && (
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] ml-1">
                              {entidades.join(" · ")}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-5 h-5 shrink-0 text-[var(--border)] group-hover:text-[var(--accent)] transition-colors" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Paginacao pagina={pagina} paginas={paginas} irPara={irParaPagina} />
    </div>
  );
};

/**
 * A consulta tem duas entradas: por pessoa (quem são as processualistas) e
 * por obra (o que foi escrito sobre um assunto). A segunda é o caminho de
 * quem procura bibliografia sobre um tema e só depois chega nas autoras.
 */
export const Consulta = () => {
  const [aba, setAba] = useState<"pessoas" | "obras">("pessoas");

  const abaCls = (ativa: boolean) =>
    `px-5 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
      ativa
        ? "border-[var(--accent)] text-[var(--accent)]"
        : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
    }`;

  return (
    <div className="space-y-5">
      <div className="flex border-b border-[var(--border)]">
        <button className={abaCls(aba === "pessoas")} onClick={() => setAba("pessoas")}>
          Processualistas
        </button>
        <button className={abaCls(aba === "obras")} onClick={() => setAba("obras")}>
          Obras
        </button>
      </div>

      {aba === "pessoas" ? <BuscaPessoas /> : <BuscaObras />}
    </div>
  );
};
