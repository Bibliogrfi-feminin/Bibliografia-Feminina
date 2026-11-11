import { useState, useEffect, useMemo, useRef, useDeferredValue } from "react";
import { Link } from "react-router-dom";
import { Search, Loader2, ExternalLink } from "lucide-react";
import { getObras, getAssociadas, Obra, Associada, semAcento } from "../lib/base";
import { Paginacao, rotuloTipo } from "./ConsultaUI";

/**
 * Busca por obra: quem procura "coisa julgada" chega na lista de trabalhos
 * e, deles, nas autoras — o caminho inverso da consulta por pessoa.
 *
 * A bibliografia é o arquivo mais pesado da base, por isso só é baixada
 * quando esta aba é aberta, e não no carregamento do site. Depois disso o
 * filtro roda em memória a cada tecla: são ~7 mil citações já normalizadas,
 * e o useDeferredValue deixa a digitação na frente do recálculo.
 */

const POR_PAGINA = 20;

/** o valor do banco e o rótulo do chip: o "P." repetido em todos só ocupava espaço */
const AREAS = [
  ["P. Civil", "Civil"], ["P. Penal", "Penal"], ["P. Trabalhista", "Trabalhista"],
  ["P. Tributario", "Tributário"], ["P. Constitucional", "Constitucional"],
  ["P. Administrativo", "Administrativo"], ["Outros", "Outros"],
] as const;

const TIPOS = [
  "Artigo", "Capitulo de Livro", "Livro",
  "Coluna em Jornais e Sites", "Anais de Eventos", "Org. ou Coord.",
  // derivados da aba 1: a titulação também é obra
  "Dissertação de Mestrado", "Tese de Doutorado", "Tese de Livre-Docência",
];

/** destaca o trecho procurado dentro da citação, ignorando acento e caixa */
function Destacado({ texto, termo }: { texto: string; termo: string }) {
  const alvo = termo.trim();
  if (!alvo) return <>{texto}</>;

  const base = semAcento(texto);
  const busca = semAcento(alvo);
  // se a versão sem acento mudar de comprimento, os índices não batem com
  // o texto original e a marcação sairia deslocada
  if (!busca || base.length !== texto.length) return <>{texto}</>;

  const partes: React.ReactNode[] = [];
  let i = 0;
  let achou = base.indexOf(busca);
  let n = 0;

  while (achou !== -1) {
    partes.push(texto.slice(i, achou));
    partes.push(
      <mark key={n++} className="bg-[var(--highlight-bg)] text-[var(--highlight)] font-semibold rounded px-0.5">
        {texto.slice(achou, achou + busca.length)}
      </mark>
    );
    i = achou + busca.length;
    achou = base.indexOf(busca, i);
  }
  partes.push(texto.slice(i));
  return <>{partes}</>;
}

export const BuscaObras = () => {
  const [obras, setObras] = useState<Obra[]>([]);
  const [autores, setAutores] = useState<Map<string, Associada>>(new Map());
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const [termo, setTermo] = useState("");
  const [area, setArea] = useState("");
  const [tipo, setTipo] = useState("");
  const [ano, setAno] = useState("");
  const [pagina, setPagina] = useState(1);
  const topoResultados = useRef<HTMLDivElement>(null);

  // uma letra casa com quase tudo; a busca começa na segunda
  const termoDiferido = useDeferredValue(termo.trim().length >= 2 ? termo.trim() : "");

  useEffect(() => {
    Promise.all([getObras(), getAssociadas()])
      .then(([o, a]) => {
        setObras(o);
        setAutores(new Map(a.map((x) => [x.id, x])));
      })
      .catch(() => setErro("Não foi possível carregar a bibliografia."))
      .finally(() => setCarregando(false));
  }, []);

  /** texto já normalizado por obra, para não refazer a cada tecla */
  const indice = useMemo(() => obras.map((o) => semAcento(o.citacao)), [obras]);

  /** só os anos que existem, do mais novo ao mais antigo; "s/d" por último */
  const anos = useMemo(() => {
    const todos = [...new Set(obras.map((o) => o.ano))];
    const comData = todos.filter((a) => /^\d{4}$/.test(a)).sort((a, b) => b.localeCompare(a));
    return todos.includes("s/d") ? [...comData, "s/d"] : comData;
  }, [obras]);

  const achadas = useMemo(() => {
    const busca = semAcento(termoDiferido);
    const res: Obra[] = [];
    for (let i = 0; i < obras.length; i++) {
      const o = obras[i];
      if (busca && !indice[i].includes(busca)) continue;
      if (area && o.area !== area) continue;
      if (tipo && o.tipo !== tipo) continue;
      if (ano && o.ano !== ano) continue;
      res.push(o);
    }
    // sem data por último; o ano é texto e "s/d" ordenaria antes de 2025
    return res.sort((a, b) => {
      const sa = /^\d{4}$/.test(a.ano) ? 0 : 1;
      const sb = /^\d{4}$/.test(b.ano) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (a.ano !== b.ano) return b.ano.localeCompare(a.ano);
      const na = autores.get(a.autorId)?.nome ?? "";
      const nb = autores.get(b.autorId)?.nome ?? "";
      return na.localeCompare(nb, "pt-BR");
    });
  }, [obras, indice, termoDiferido, area, tipo, ano, autores]);

  useEffect(() => { setPagina(1); }, [termoDiferido, area, tipo, ano]);

  const total = achadas.length;
  const paginas = Math.ceil(total / POR_PAGINA) || 1;
  const visiveis = achadas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const temFiltro = Boolean(termo || area || tipo || ano);
  const atualizando = termoDiferido !== (termo.trim().length >= 2 ? termo.trim() : "");

  const limpar = () => { setTermo(""); setArea(""); setTipo(""); setAno(""); };

  const campoCls =
    "px-3 py-2 bg-white border border-[var(--border)] rounded-lg text-sm outline-none focus:ring-1 focus:ring-[var(--accent)] text-[var(--text-main)]";

  const irParaPagina = (n: number) => {
    setPagina(n);
    topoResultados.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20 text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando a bibliografia…
      </div>
    );
  }

  if (erro) {
    return (
      <div className="bg-white rounded-xl border border-[var(--border)] py-16 text-center">
        <p className="text-[var(--error)]">{erro}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-xl border border-[var(--border)]">
        <form onSubmit={(e) => e.preventDefault()} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[260px]">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
              Buscar no título ou na citação
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Ex: coisa julgada, tutela provisória, execução…"
                className="w-full pl-10 pr-4 py-2 bg-white border border-[var(--border)] rounded-lg text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
              />
              <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-3" />
            </div>
          </div>

          <div className="w-44">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Área</label>
            <select value={area} onChange={(e) => setArea(e.target.value)} className={`w-full ${campoCls}`}>
              <option value="">Todas</option>
              {AREAS.map(([valor]) => <option key={valor} value={valor}>{valor}</option>)}
            </select>
          </div>

          <div className="w-52">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Tipo de obra</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`w-full ${campoCls}`}>
              <option value="">Todos</option>
              {TIPOS.map((t) => <option key={t} value={t}>{rotuloTipo(t)}</option>)}
            </select>
          </div>

          <div className="w-28">
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Ano</label>
            <select value={ano} onChange={(e) => setAno(e.target.value)} className={`w-full ${campoCls}`}>
              <option value="">Todos</option>
              {anos.map((a) => <option key={a} value={a}>{a === "s/d" ? "Sem data" : a}</option>)}
            </select>
          </div>

          {temFiltro && (
            <button
              type="button"
              onClick={limpar}
              className="px-3 py-2 text-sm font-semibold text-[var(--text-muted)] hover:text-[var(--accent)]"
            >
              Limpar
            </button>
          )}
        </form>
      </div>

      <div ref={topoResultados} className={`scroll-mt-24 transition-opacity ${atualizando ? "opacity-60" : ""}`}>
        <p className="text-[14px] text-[var(--text-muted)] mb-3">
          <span className="font-semibold text-[var(--text-main)] tabular-nums">{total.toLocaleString("pt-BR")}</span>
          {total === 1 ? " obra" : " obras"}
          {termoDiferido && <> sobre <span className="font-semibold text-[var(--text-main)]">“{termoDiferido}”</span></>}
        </p>

        {visiveis.length === 0 ? (
          <div className="bg-white rounded-xl border border-[var(--border)] py-14 text-center">
            <p className="text-[var(--text-muted)]">Nenhuma obra encontrada com esses critérios.</p>
            <button type="button" onClick={limpar} className="mt-3 text-[13px] font-semibold text-[var(--accent)] hover:text-[var(--heading)]">
              Limpar filtros
            </button>
          </div>
        ) : (
          <ul className="bg-white rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]">
            {visiveis.map((o) => {
              const autor = autores.get(o.autorId);
              return (
                <li key={o.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] mb-1.5">
                    <span className="font-semibold uppercase tracking-wider text-[var(--accent)]">{rotuloTipo(o.tipo)}</span>
                    <span className="text-[var(--border)]">·</span>
                    <span className="text-[var(--text-muted)] tabular-nums">{o.ano === "s/d" ? "sem data" : o.ano}</span>
                    <span className="text-[var(--border)]">·</span>
                    <span className="text-[var(--text-muted)]">{AREAS.find(([v]) => v === o.area)?.[1] ?? o.area}</span>
                  </div>
                  <p className="text-[14px] text-[var(--text-main)] leading-relaxed">
                    <Destacado texto={o.citacao} termo={termoDiferido} />
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                    {autor && (
                      <Link to={`/consulta/${autor.id}`} className="font-semibold text-[var(--accent)] hover:text-[var(--heading)] hover:underline">
                        {autor.nome}
                        {autor.uf && <span className="font-normal text-[var(--text-muted)]"> · {autor.uf}</span>}
                      </Link>
                    )}
                    {o.link && (
                      <a
                        href={o.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[var(--accent)] font-semibold hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Texto completo
                      </a>
                    )}
                  </div>
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
