import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookMarked, ChevronDown, FlaskConical, Users } from "lucide-react";
import { usePagina } from "../lib/conteudo";
import { Markdown } from "../lib/markdown";
import { Equipe } from "../components/Equipe";

/**
 * O Projeto: o que eram três páginas de leitura (Sobre, Metodologia e Quem
 * Somos) numa só, com uma barra para pular entre as seções.
 *
 * Os textos seguem vindo das três linhas de `paginas`, editáveis pelo
 * painel. O desenho sai dos títulos "## " do próprio markdown: um título
 * no formato "1ª Etapa: …" vira um passo numerado da linha do tempo, e
 * qualquer outro vira um cartão. Cada um mostra só o primeiro parágrafo
 * até a leitora pedir o resto — a metodologia tem mais de 1.700 palavras.
 *
 * A seção ativa vai no endereço como ?secao=, e não como #: dentro do
 * iframe do WordPress só o caminho e a busca são espelhados na página da
 * USP, então é assim que um link direto para a metodologia sobrevive.
 */

const SECOES = [
  { id: "sobre", rotulo: "Sobre", Icone: BookMarked },
  { id: "metodologia", rotulo: "Metodologia", Icone: FlaskConical },
  { id: "equipe", rotulo: "Equipe", Icone: Users },
] as const;

type IdSecao = (typeof SECOES)[number]["id"];

interface Bloco { titulo: string; corpo: string; resumo: string; etapa: number | null }

/** separa o texto de abertura dos blocos que começam em "## " */
function emBlocos(md: string): { abertura: string; blocos: Bloco[] } {
  const partes = (md ?? "").replace(/\r\n/g, "\n").split(/^##\s+/m);
  const abertura = partes.shift()?.trim() ?? "";
  const blocos = partes.map((parte) => {
    const [primeira, ...resto] = parte.split("\n");
    const titulo = primeira.trim();
    const corpo = resto.join("\n").trim();
    const etapa = titulo.match(/^(\d+)\s*[ªº°]?\s*etapa\b\s*[:–-]?\s*(.*)$/i);
    return {
      titulo: etapa ? etapa[2] || titulo : titulo,
      corpo,
      // o primeiro parágrafo do bloco, que é o que aparece fechado
      resumo: corpo.split(/\n\s*\n/)[0] ?? "",
      etapa: etapa ? Number(etapa[1]) : null,
    };
  });
  return { abertura, blocos };
}

/** fechado, o bloco mostra 3 linhas; mais que isso pede o "ler" — inclusive num parágrafo único longo */
const temMais = (b: Bloco) => b.corpo.trim() !== b.resumo.trim() || b.resumo.length > 320;

const Expansivel = ({ bloco, aberto, alternar }: { bloco: Bloco; aberto: boolean; alternar: () => void }) => {
  const mais = temMais(bloco);
  return (
    <>
      {aberto || !mais ? (
        <Markdown texto={bloco.corpo} />
      ) : (
        <div className="line-clamp-3">
          <Markdown texto={bloco.resumo} />
        </div>
      )}
      {mais && (
        <button
          onClick={alternar}
          aria-expanded={aberto}
          className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--accent)] hover:text-[var(--heading)]"
        >
          {aberto ? "Recolher" : bloco.etapa ? "Ler a etapa completa" : "Ler tudo"}
          <ChevronDown className={`w-4 h-4 transition-transform ${aberto ? "rotate-180" : ""}`} />
        </button>
      )}
    </>
  );
};

const CabecalhoSecao = ({ rotulo, titulo, subtitulo }: { rotulo: string; titulo?: string; subtitulo?: string | null }) => (
  <div className="mb-8">
    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--highlight)] mb-2">{rotulo}</p>
    <h2 className="text-[28px] md:text-[32px] font-serif font-bold text-[var(--heading)] leading-tight">{titulo}</h2>
    {subtitulo && <p className="mt-2 text-[17px] text-[var(--text-muted)] max-w-2xl">{subtitulo}</p>}
  </div>
);

export const OProjeto = () => {
  const sobre = usePagina("sobre");
  const metodologia = usePagina("metodologia");
  const quem = usePagina("quem-somos");
  const carregando = sobre.carregando || metodologia.carregando || quem.carregando;

  const [params, setParams] = useSearchParams();
  const [ativa, setAtiva] = useState<IdSecao>("sobre");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const rolouParaInicial = useRef(false);

  const s = useMemo(() => emBlocos(sobre.pagina?.conteudo ?? ""), [sobre.pagina]);
  const m = useMemo(() => emBlocos(metodologia.pagina?.conteudo ?? ""), [metodologia.pagina]);
  const etapas = m.blocos.filter((b) => b.etapa !== null);
  const outros = m.blocos.filter((b) => b.etapa === null);
  const expansiveis = m.blocos.filter(temMais).map((b) => b.titulo);
  const tudoAberto = expansiveis.length > 0 && expansiveis.every((t) => abertos.has(t));

  const alternar = (titulo: string) =>
    setAbertos((atual) => {
      const novo = new Set(atual);
      novo.has(titulo) ? novo.delete(titulo) : novo.add(titulo);
      return novo;
    });

  const irPara = (id: IdSecao) => {
    setParams({ secao: id }, { replace: true });
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // link direto (?secao=metodologia): rola uma vez, quando o texto já ocupa a altura final
  useEffect(() => {
    if (carregando || rolouParaInicial.current) return;
    rolouParaInicial.current = true;
    const alvo = params.get("secao");
    if (alvo && SECOES.some((x) => x.id === alvo)) {
      requestAnimationFrame(() => document.getElementById(alvo)?.scrollIntoView({ block: "start" }));
    }
  }, [carregando, params]);

  // destaca na barra a seção que está no meio da tela
  useEffect(() => {
    if (carregando) return;
    const obs = new IntersectionObserver(
      (entradas) => entradas.forEach((e) => e.isIntersecting && setAtiva(e.target.id as IdSecao)),
      { rootMargin: "-45% 0px -50% 0px" }
    );
    SECOES.forEach(({ id }) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [carregando]);

  if (carregando) {
    return <div className="max-w-4xl mx-auto py-20 text-center text-[var(--text-muted)]">Carregando…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto pb-24 fade-in">
      <header className="pt-12 pb-8 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)] mb-4">
          Grupo de pesquisa · Faculdade de Direito da USP
        </p>
        <h1 className="text-4xl md:text-[2.75rem] font-serif font-bold text-[var(--heading)] leading-tight">O Projeto</h1>
        <p className="mt-4 text-lg text-[var(--text-muted)] max-w-2xl mx-auto leading-relaxed">
          Por que o levantamento existe, como foi feito e quem o conduziu.
        </p>
      </header>

      {/* abaixo da barra de navegação do site, que tem h-16 */}
      <nav
        aria-label="Seções da página"
        className="sticky top-16 z-40 -mx-4 px-4 py-3 mb-12 bg-[var(--bg)]/90 backdrop-blur border-b border-[var(--border)]"
      >
        <div className="flex justify-center gap-2 overflow-x-auto">
          {SECOES.map(({ id, rotulo, Icone }) => (
            <button
              key={id}
              onClick={() => irPara(id)}
              aria-current={ativa === id ? "true" : undefined}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors border ${
                ativa === id
                  ? "bg-[var(--accent)] text-white border-transparent"
                  : "bg-white text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--accent)] hover:border-[var(--heading)]"
              }`}
            >
              <Icone className="w-4 h-4" />
              {rotulo}
            </button>
          ))}
        </div>
      </nav>

      {/* scroll-mt: a seção para abaixo das duas barras fixas, e não atrás delas */}
      <section id="sobre" className="scroll-mt-36">
        <CabecalhoSecao rotulo="Sobre" titulo={sobre.pagina?.titulo} subtitulo={sobre.pagina?.subtitulo} />
        {/* empilhados: lado a lado, o cartão do objetivo ficava com o dobro da altura do texto */}
        {s.abertura && (
          <div className="max-w-3xl mb-8 [&_p]:text-[17px] [&_p]:text-[var(--text-main)]">
            <Markdown texto={s.abertura} />
          </div>
        )}
        {s.blocos.map((b) => (
          <aside key={b.titulo} className="rounded-xl bg-[var(--highlight-bg)] border-l-4 border-[var(--highlight)] p-6 md:p-8 mb-4">
            <h3 className="font-serif font-bold text-[var(--highlight)] mb-3">{b.titulo}</h3>
            <div className="[&_p]:text-[var(--text-main)]">
              <Markdown texto={b.corpo} />
            </div>
          </aside>
        ))}
      </section>

      <section id="metodologia" className="scroll-mt-36 mt-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <CabecalhoSecao rotulo="Metodologia" titulo={metodologia.pagina?.titulo} subtitulo={metodologia.pagina?.subtitulo} />
          {expansiveis.length > 1 && (
            <button
              onClick={() => setAbertos(tudoAberto ? new Set() : new Set(expansiveis))}
              className="mb-8 text-[13px] font-semibold text-[var(--accent)] hover:text-[var(--heading)]"
            >
              {tudoAberto ? "Recolher tudo" : "Expandir tudo"}
            </button>
          )}
        </div>

        {/* sem caixa: é a introdução da linha do tempo, que vem logo abaixo */}
        {m.abertura && (
          <div className="max-w-3xl mb-10">
            <Markdown texto={m.abertura} />
          </div>
        )}

        {etapas.length > 0 && (
          <ol className="mb-12">
            {etapas.map((b, i) => (
              <li key={b.titulo} className="relative pl-14 pb-6 last:pb-0">
                {/* o fio da linha do tempo liga o círculo desta etapa ao da próxima */}
                {i < etapas.length - 1 && (
                  <span aria-hidden className="absolute left-5 top-10 bottom-0 w-px bg-[var(--border)]" />
                )}
                <span
                  aria-hidden
                  className="absolute left-0 top-0 w-10 h-10 rounded-full bg-[var(--accent)] text-white font-serif font-bold flex items-center justify-center tabular-nums"
                >
                  {b.etapa}
                </span>
                <div className="rounded-xl bg-white border border-[var(--border)] p-6">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--text-muted)] mb-1">
                    Etapa {b.etapa}
                  </p>
                  <h3 className="font-serif font-bold text-[18px] text-[var(--text-main)] mb-3">{b.titulo}</h3>
                  <Expansivel bloco={b} aberto={abertos.has(b.titulo)} alternar={() => alternar(b.titulo)} />
                </div>
              </li>
            ))}
          </ol>
        )}

        {outros.length > 0 && (
          <div className="grid gap-5 md:grid-cols-2 items-start">
            {outros.map((b) => (
              <div key={b.titulo} className="rounded-xl bg-white border border-[var(--border)] border-t-4 border-t-[var(--highlight)] p-6">
                <h3 className="font-serif font-bold text-[17px] text-[var(--text-main)] mb-3">{b.titulo}</h3>
                <Expansivel bloco={b} aberto={abertos.has(b.titulo)} alternar={() => alternar(b.titulo)} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="equipe" className="scroll-mt-36 mt-20">
        <CabecalhoSecao rotulo="Equipe" titulo={quem.pagina?.titulo} subtitulo={quem.pagina?.subtitulo} />
        {quem.pagina?.conteudo && (
          <div className="rounded-xl bg-white border border-[var(--border)] p-6 md:p-8 mb-12">
            <Markdown texto={quem.pagina.conteudo} />
          </div>
        )}
        <Equipe />
      </section>
    </div>
  );
};
