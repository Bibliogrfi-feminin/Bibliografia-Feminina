import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Download, ExternalLink } from "lucide-react";
import { baixarXlsx, baixarCsv, deRegistros } from "../lib/xlsx";
import { getAssociadas, getObras, Associada, Obra, semAcento } from "../lib/base";
import { BuscaObras } from "../components/BuscaObras";

const POR_PAGINA = 15;

/**
 * Consulta de pessoas sobre a base estática.
 *
 * A lista inteira são 66 KB comprimidos, então filtrar e paginar no
 * navegador sai mais rápido do que ir ao servidor a cada tecla — e o site
 * público deixa de depender do banco.
 */
const BuscaPessoas = () => {
  const [todas, setTodas] = useState<Associada[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [uf, setUf] = useState("");
  const [ibdp, setIbdp] = useState("");
  const [abep, setAbep] = useState("");
  const [docente, setDocente] = useState("");
  const [ranking, setRanking] = useState("");
  const [formacao, setFormacao] = useState("");

  /**
   * A busca também alcança o conteúdo das obras: quem procura "coisa
   * julgada" quer as autoras que escreveram sobre isso, não só quem tem
   * essas palavras no nome.
   *
   * A bibliografia pesa 441 KB contra os 66 KB da lista de pessoas, então
   * só é baixada quando alguém realmente busca — e uma vez só. Até ela
   * chegar, a busca por nome já responde.
   */
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [buscandoObras, setBuscandoObras] = useState(false);

  const navigate = useNavigate();

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

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    return todas.filter((a) => {
      if (termo) {
        const alvo = semAcento(`${a.nome} ${a.email ?? ""} ${a.instituicao ?? ""}`);
        // entra por dado próprio ou por ter obra sobre o assunto
        if (!alvo.includes(termo) && !acertosPorAutora.has(a.id)) return false;
      }
      if (uf && (a.uf ?? "").toUpperCase() !== uf.toUpperCase()) return false;
      if (ibdp !== "" && a.ibdp !== (ibdp === "true")) return false;
      if (abep !== "" && a.abep !== (abep === "true")) return false;
      if (docente !== "" && a.leciona !== (docente === "true")) return false;
      if (ranking !== "" && a.ranking40 !== (ranking === "true")) return false;
      if (formacao === "doutora" && !a.doutora) return false;
      if (formacao === "mestre" && !a.mestre) return false;
      if (formacao === "especialista" && !a.especialista) return false;
      if (formacao === "livre_docente" && !a.livreDocente) return false;
      return true;
    });
  }, [todas, busca, uf, ibdp, abep, docente, ranking, formacao, acertosPorAutora]);

  // qualquer mudança de critério volta para a primeira página
  useEffect(() => { setPagina(1); }, [busca, uf, ibdp, abep, docente, ranking, formacao]);

  const paginas = Math.ceil(filtradas.length / POR_PAGINA) || 1;
  const visiveis = filtradas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);

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

  const campoCls =
    "w-full px-3 py-2 bg-white border border-[var(--border)] rounded-lg text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none";

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-xl border border-[var(--border)]">
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Busca</label>
            <div className="relative">
              <input
                type="text"
                placeholder="Nome, instituição ou assunto de uma obra…"
                className={`${campoCls} pl-10`}
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
              <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-3" />
            </div>
            <p className="text-[11px] text-[var(--text-muted)] mt-1.5 h-4">
              {buscandoObras
                ? "buscando também nas obras…"
                : busca.trim().length >= 3 && acertosPorAutora.size > 0
                ? `${acertosPorAutora.size} ${acertosPorAutora.size === 1 ? "autora escreveu" : "autoras escreveram"} sobre isso`
                : ""}
            </p>
          </div>

          <div className="w-20">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">UF</label>
            <input type="text" placeholder="SP" maxLength={2} className={`${campoCls} uppercase`}
              value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} />
          </div>

          <div className="w-28">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">IBDP</label>
            <select value={ibdp} onChange={(e) => setIbdp(e.target.value)} className={campoCls}>
              <option value="">Todos</option><option value="true">Sim</option><option value="false">Não</option>
            </select>
          </div>

          <div className="w-28">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">ABEP</label>
            <select value={abep} onChange={(e) => setAbep(e.target.value)} className={campoCls}>
              <option value="">Todos</option><option value="true">Sim</option><option value="false">Não</option>
            </select>
          </div>

          <div className="w-32">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Docente</label>
            <select value={docente} onChange={(e) => setDocente(e.target.value)} className={campoCls}>
              <option value="">Todos</option><option value="true">Sim</option><option value="false">Não</option>
            </select>
          </div>

          <div className="w-32">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Ranking 40+</label>
            <select value={ranking} onChange={(e) => setRanking(e.target.value)} className={campoCls}>
              <option value="">Todos</option><option value="true">Sim</option><option value="false">Não</option>
            </select>
          </div>

          <div className="w-40">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Titulação</label>
            <select value={formacao} onChange={(e) => setFormacao(e.target.value)} className={campoCls}>
              <option value="">Todas</option>
              <option value="doutora">Doutora</option>
              <option value="mestre">Mestre</option>
              <option value="especialista">Especialista</option>
              <option value="livre_docente">Livre-Docente</option>
            </select>
          </div>

          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => exportar("csv")}
              className="flex items-center px-3.5 py-2 bg-white border border-[var(--border)] text-[var(--text-main)] text-sm font-semibold rounded-lg hover:bg-[var(--row-hover)] transition">
              <Download className="w-4 h-4 mr-2 text-[var(--text-muted)]" /> CSV
            </button>
            <button type="button" onClick={() => exportar("xlsx")}
              className="flex items-center px-3.5 py-2 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition">
              <Download className="w-4 h-4 mr-2" /> Excel
            </button>
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">
              <tr>
                <th className="px-6 py-3 font-semibold">Nome</th>
                <th className="px-4 py-3 font-semibold">Atuação</th>
                <th className="px-4 py-3 font-semibold text-center">UF</th>
                <th className="px-4 py-3 font-semibold">Titulação</th>
                {/* IBDP e ABEP guiaram a busca das autoras, mas não são o que
                    se quer ver delas: a coluna leva ao currículo. As
                    entidades seguem nos filtros, na ficha e na exportação. */}
                <th className="px-4 py-3 font-semibold text-center">Lattes</th>
                <th className="px-6 py-3 font-semibold text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {carregando ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--text-muted)]">Carregando…</td></tr>
              ) : erro ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--error)]">{erro}</td></tr>
              ) : visiveis.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--text-muted)]">Nenhum registro encontrado.</td></tr>
              ) : (
                visiveis.map((a) => (
                  <tr key={a.id} className="hover:bg-[var(--row-hover)] transition-colors">
                    <td className="px-6 py-4 font-semibold text-[var(--text-main)]">
                      {a.nome}
                      {a.incompleto && (
                        <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-[var(--warning-bg)] text-[var(--warning)] font-bold uppercase">
                          incompleto
                        </span>
                      )}
                      {/* diz por que a pessoa apareceu quando o termo não
                          está no nome dela, mas nas obras que escreveu */}
                      {acertosPorAutora.has(a.id) && (
                        <span className="ml-2 px-1.5 py-0.5 text-[9px] rounded bg-[var(--nav-active)] text-[var(--accent)] font-bold uppercase whitespace-nowrap">
                          {acertosPorAutora.get(a.id)}{" "}
                          {acertosPorAutora.get(a.id) === 1 ? "obra" : "obras"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-[var(--text-muted)]">{a.atuacao ?? "—"}</td>
                    <td className="px-4 py-4 text-center text-[var(--text-muted)]">{a.uf ?? "—"}</td>
                    <td className="px-4 py-4 text-[var(--text-muted)]">
                      {[a.livreDocente && "Livre-doc.", a.doutora && "Doutora", a.mestre && "Mestre", a.especialista && "Espec."]
                        .filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-4 text-center">
                      {a.lattes ? (
                        <a
                          href={a.lattes}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Currículo Lattes de ${a.nome}`}
                          className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] hover:underline"
                        >
                          Lattes <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => navigate(`/consulta/${a.id}`)}
                        className="px-3 py-1.5 text-xs font-semibold text-[var(--accent)] border border-[var(--accent)] rounded-lg hover:bg-[var(--accent)] hover:text-white transition"
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between text-xs text-[var(--text-muted)]">
          <div>
            {filtradas.length.toLocaleString("pt-BR")} {filtradas.length === 1 ? "registro" : "registros"}
            {filtradas.length !== todas.length && ` (de ${todas.length.toLocaleString("pt-BR")})`}
            {" · "}página <span className="font-semibold text-[var(--text-main)]">{pagina}</span> de {paginas}
          </div>
          <div className="flex gap-1">
            <button disabled={pagina === 1} onClick={() => setPagina(pagina - 1)}
              className="px-3 py-1 bg-white border border-[var(--border)] rounded hover:bg-[var(--row-hover)] disabled:opacity-40">
              Anterior
            </button>
            <button disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}
              className="px-3 py-1 bg-white border border-[var(--border)] rounded hover:bg-[var(--row-hover)] disabled:opacity-40">
              Próximo
            </button>
          </div>
        </div>
      </div>
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
