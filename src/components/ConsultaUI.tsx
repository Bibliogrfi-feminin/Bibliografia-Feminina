import { ReactNode } from "react";

/** peças comuns às duas abas da Consulta (processualistas e obras) */

/**
 * O tipo_obra do banco vem com caixa misturada ("Anais de Eventos",
 * "Capitulo de Livro", sem acento). Na tela, todos em caixa de frase.
 */
const ROTULOS_TIPO: Record<string, string> = {
  "Capitulo de Livro": "Capítulo de livro",
  "Anais de Eventos": "Anais de eventos",
  "Coluna em Jornais e Sites": "Coluna em jornais e sites",
  "Org. ou Coord.": "Organização ou coordenação",
  "Dissertação de Mestrado": "Dissertação de mestrado",
  "Tese de Doutorado": "Tese de doutorado",
  "Tese de Livre-Docência": "Tese de livre-docência",
};
export const rotuloTipo = (t: string) => ROTULOS_TIPO[t] ?? t;

export const ROTULO_FILTRO ="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]";

export const Chip = ({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={ativo}
    className={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
      ativo
        ? "bg-[var(--accent)] text-white border-transparent"
        : "bg-white text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--accent)] hover:border-[var(--heading)]"
    }`}
  >
    {children}
  </button>
);

export const SELECT_CHIP =
  "px-3 py-1.5 bg-white border border-[var(--border)] rounded-full text-[13px] font-semibold text-[var(--text-main)] focus:ring-1 focus:ring-[var(--accent)] outline-none";

/** 1 … 4 5 6 … 26: a página atual com vizinhas, mais as pontas */
function numerosDePagina(atual: number, total: number): (number | "…")[] {
  const set = new Set([1, total, atual - 1, atual, atual + 1].filter((n) => n >= 1 && n <= total));
  const ordem = [...set].sort((a, b) => a - b);
  return ordem.flatMap((n, i) => (i > 0 && n - ordem[i - 1] > 1 ? ["…" as const, n] : [n]));
}

export const Paginacao = ({ pagina, paginas, irPara }: { pagina: number; paginas: number; irPara: (n: number) => void }) => {
  if (paginas <= 1) return null;
  const seta = "px-3 py-1.5 rounded-md font-semibold text-[var(--accent)] hover:bg-[var(--nav-active)] disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <nav aria-label="Páginas" className="flex flex-wrap items-center justify-center gap-1 text-[13px]">
      <button type="button" disabled={pagina === 1} onClick={() => irPara(pagina - 1)} className={seta}>
        Anterior
      </button>
      {numerosDePagina(pagina, paginas).map((n, i) =>
        n === "…" ? (
          <span key={`r${i}`} className="px-2 text-[var(--text-muted)]">…</span>
        ) : (
          <button
            key={n}
            type="button"
            onClick={() => irPara(n)}
            aria-current={n === pagina ? "page" : undefined}
            className={`min-w-9 px-2 py-1.5 rounded-md font-semibold tabular-nums ${
              n === pagina ? "bg-[var(--accent)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--nav-active)] hover:text-[var(--accent)]"
            }`}
          >
            {n}
          </button>
        )
      )}
      <button type="button" disabled={pagina >= paginas} onClick={() => irPara(pagina + 1)} className={seta}>
        Próximo
      </button>
    </nav>
  );
};
