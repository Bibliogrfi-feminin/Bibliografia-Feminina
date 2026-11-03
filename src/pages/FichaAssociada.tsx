import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, GraduationCap, Mail, Loader2, Search } from "lucide-react";
import { getAssociada, getObrasDe, Associada, Obra, Titulacao, semAcento } from "../lib/base";
import { Chip, rotuloTipo } from "../components/ConsultaUI";

/**
 * Ficha pública de uma processualista.
 *
 * A mediana é de 11 obras por pessoa, mas há quem chegue a quase 400: por isso a
 * bibliografia se filtra por tipo (com a contagem de cada um), aceita uma
 * busca própria, vem agrupada por ano e mostra 20 de cada vez.
 *
 * Dissertações e teses ficam no quadro de Titulação e não se repetem na
 * lista: na base elas são obras (origem "titulacao"), e nas buscas e nos
 * totais do site continuam contando.
 */

const LOTE = 20;

const AREA_CURTA: Record<string, string> = {
  "P. Civil": "Civil", "P. Penal": "Penal", "P. Trabalhista": "Trabalhista",
  "P. Tributario": "Tributário", "P. Constitucional": "Constitucional",
  "P. Administrativo": "Administrativo",
};

const CartaoTitulacao = ({ nome, t }: { nome: string; t: Titulacao | null }) => {
  if (!t || !(t.titulo || t.ano || t.faculdade || t.area || t.link)) return null;
  return (
    <div className="rounded-xl bg-white border border-[var(--border)] border-t-4 border-t-[var(--accent)] p-5 flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">{nome}</p>
        {t.ano && <span className="text-[13px] font-semibold text-[var(--text-muted)] tabular-nums">{t.ano}</span>}
      </div>
      {t.titulo && <p className="mt-2 text-[14px] font-semibold text-[var(--text-main)] leading-snug">{t.titulo}</p>}
      {(t.faculdade || t.area) && (
        <p className="mt-2 text-[12px] text-[var(--text-muted)] leading-relaxed">{[t.faculdade, t.area].filter(Boolean).join(" · ")}</p>
      )}
      {t.link && (
        <a href={t.link} target="_blank" rel="noopener noreferrer"
          className="mt-auto pt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)] hover:underline">
          <ExternalLink className="w-3.5 h-3.5" /> Acessar o trabalho
        </a>
      )}
    </div>
  );
};

export const FichaAssociada = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [pessoa, setPessoa] = useState<Associada | null>(null);
  const [obras, setObras] = useState<Obra[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [carregandoObras, setCarregandoObras] = useState(true);

  const [tipo, setTipo] = useState("");
  const [busca, setBusca] = useState("");
  const [quantas, setQuantas] = useState(LOTE);

  useEffect(() => {
    if (!id) return;
    setCarregando(true);
    getAssociada(id)
      .then(setPessoa)
      .catch(() => setPessoa(null))
      .finally(() => setCarregando(false));

    // a bibliografia é o arquivo pesado: carrega em separado, para os dados
    // da pessoa aparecerem sem esperar por ela
    setCarregandoObras(true);
    getObrasDe(id)
      .then(setObras)
      .catch(() => setObras([]))
      .finally(() => setCarregandoObras(false));
    setTipo(""); setBusca(""); setQuantas(LOTE);
  }, [id]);

  const bibliografia = useMemo(
    () => obras
      .filter((o) => o.origem !== "titulacao")
      .sort((a, b) => {
        const sa = /^\d{4}$/.test(a.ano) ? 0 : 1;
        const sb = /^\d{4}$/.test(b.ano) ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return b.ano.localeCompare(a.ano);
      }),
    [obras]
  );

  /** os tipos que ela tem, do mais frequente ao menos */
  const contagemPorTipo = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of bibliografia) m.set(o.tipo, (m.get(o.tipo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [bibliografia]);

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    return bibliografia.filter((o) => (!tipo || o.tipo === tipo) && (!termo || semAcento(o.citacao).includes(termo)));
  }, [bibliografia, tipo, busca]);

  // trocar o filtro recomeça do primeiro lote
  useEffect(() => { setQuantas(LOTE); }, [tipo, busca]);

  /** o lote visível, agrupado por ano, mantendo a ordem do mais novo ao mais antigo */
  const porAno = useMemo(() => {
    const grupos: { ano: string; obras: Obra[] }[] = [];
    for (const o of filtradas.slice(0, quantas)) {
      const ultimo = grupos[grupos.length - 1];
      if (ultimo?.ano === o.ano) ultimo.obras.push(o);
      else grupos.push({ ano: o.ano, obras: [o] });
    }
    return grupos;
  }, [filtradas, quantas]);

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-24 text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
      </div>
    );
  }

  if (!pessoa) {
    return (
      <div className="max-w-2xl mx-auto py-24 text-center">
        <p className="text-[var(--text-muted)] mb-6">Processualista não encontrada.</p>
        <Link to="/consulta" className="text-[var(--accent)] font-semibold hover:underline">
          Voltar para a consulta
        </Link>
      </div>
    );
  }

  const titulos = [
    pessoa.livreDocente && "Livre-docente",
    pessoa.doutora && "Doutora",
    pessoa.mestre && "Mestre",
    pessoa.especialista && "Especialista",
  ].filter(Boolean) as string[];
  const entidades = [pessoa.ibdp && "IBDP", pessoa.abep && "ABEP", pessoa.ranking40 && "Ranking 40+"].filter(Boolean) as string[];
  const temTitulacao = [pessoa.mestrado, pessoa.doutorado, pessoa.livreDocencia].some(Boolean);
  const anosComData = bibliografia.map((o) => o.ano).filter((a) => /^\d{4}$/.test(a));
  const botao = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-colors";

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 fade-in">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--accent)]"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar
      </button>

      <header className="bg-white rounded-xl border border-[var(--border)] p-6 md:p-8">
        <h1 className="text-[28px] md:text-[32px] font-serif font-bold text-[var(--heading)] leading-tight">{pessoa.nome}</h1>
        <p className="mt-2 text-[15px] text-[var(--text-muted)]">
          {[pessoa.atuacao, pessoa.instituicao, pessoa.uf].filter(Boolean).join(" · ") || "Atuação não informada"}
        </p>

        {pessoa.incompleto && (
          <p className="mt-4 text-[13px] text-[var(--warning)] bg-[var(--warning-bg)] rounded-lg px-3 py-2">
            Registro incompleto: esta pesquisadora aparece na bibliografia, mas ainda não tem
            ficha preenchida no levantamento.
          </p>
        )}

        {(titulos.length > 0 || entidades.length > 0) && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {titulos.map((t) => (
              <span key={t} className="px-2.5 py-1 text-[12px] font-semibold rounded bg-[var(--nav-active)] text-[var(--accent)]">{t}</span>
            ))}
            {entidades.map((e) => (
              <span key={e} className="px-2.5 py-1 text-[12px] font-semibold rounded border border-[var(--border)] text-[var(--text-muted)]">{e}</span>
            ))}
          </div>
        )}

        {(pessoa.lattes || pessoa.email) && (
          <div className="mt-6 pt-5 border-t border-[var(--border)] flex flex-wrap items-center gap-2">
            {pessoa.lattes && (
              <a href={pessoa.lattes} target="_blank" rel="noopener noreferrer"
                className={`${botao} bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]`}>
                <GraduationCap className="w-4 h-4" /> Currículo Lattes
              </a>
            )}
            {pessoa.email && (
              <a href={`mailto:${pessoa.email}`}
                className={`${botao} border border-[var(--border)] text-[var(--accent)] hover:border-[var(--heading)]`}>
                <Mail className="w-4 h-4" /> {pessoa.email}
              </a>
            )}
            {pessoa.lattesAtualizado && (
              <span className="text-[12px] text-[var(--text-muted)] sm:ml-auto">
                Lattes atualizado em {new Date(pessoa.lattesAtualizado + "T12:00:00").toLocaleDateString("pt-BR")}
              </span>
            )}
          </div>
        )}
      </header>

      {temTitulacao && (
        <section>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)] mb-3">Titulação</h2>
          <div className="grid gap-4 md:grid-cols-3 items-stretch">
            <CartaoTitulacao nome="Mestrado" t={pessoa.mestrado} />
            <CartaoTitulacao nome="Doutorado" t={pessoa.doutorado} />
            <CartaoTitulacao nome="Livre-docência" t={pessoa.livreDocencia} />
          </div>
        </section>
      )}

      <section className="bg-white rounded-xl border border-[var(--border)] p-6 md:p-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-5">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--accent)]">Produção bibliográfica</h2>
          {!carregandoObras && bibliografia.length > 0 && (
            <p className="text-[13px] text-[var(--text-muted)]">
              <span className="font-semibold text-[var(--text-main)] tabular-nums">{bibliografia.length}</span>{" "}
              {bibliografia.length === 1 ? "obra" : "obras"}
              {anosComData.length > 0 && ` · ${anosComData[anosComData.length - 1]}–${anosComData[0]}`}
            </p>
          )}
        </div>

        {carregandoObras ? (
          <p className="text-[13px] text-[var(--text-muted)] flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando obras…
          </p>
        ) : bibliografia.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">Nenhuma obra registrada para esta pesquisadora no levantamento.</p>
        ) : (
          <>
            {/* com poucas obras, filtro e busca só atrapalhariam */}
            {bibliografia.length > 8 && (
              <div className="space-y-3 mb-6">
                <div className="flex flex-wrap gap-2">
                  <Chip ativo={tipo === ""} onClick={() => setTipo("")}>Todas · {bibliografia.length}</Chip>
                  {contagemPorTipo.map(([t, n]) => (
                    <Chip key={t} ativo={tipo === t} onClick={() => setTipo(tipo === t ? "" : t)}>{rotuloTipo(t)} · {n}</Chip>
                  ))}
                </div>
                <div className="relative max-w-md">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="search"
                    aria-label="Buscar entre as obras desta pesquisadora"
                    placeholder="Buscar entre as obras dela…"
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[14px] focus:bg-white focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent outline-none"
                  />
                </div>
              </div>
            )}

            {filtradas.length === 0 ? (
              <p className="text-[13px] text-[var(--text-muted)] py-4">Nenhuma obra com esses critérios.</p>
            ) : (
              <div className="space-y-6">
                {porAno.map((g) => (
                  <div key={g.ano} className="grid grid-cols-[3.5rem_1fr] gap-x-4">
                    <p className="text-[15px] font-serif font-bold text-[var(--heading)] tabular-nums pt-0.5">
                      {g.ano === "s/d" ? "s/d" : g.ano}
                    </p>
                    <ul className="space-y-3 border-l border-[var(--border)] pl-4">
                      {g.obras.map((o) => (
                        <li key={o.id}>
                          <p className="text-[14px] text-[var(--text-main)] leading-relaxed">{o.citacao}</p>
                          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                            <span className="font-semibold text-[var(--accent)]">{rotuloTipo(o.tipo)}</span>
                            {" · "}{AREA_CURTA[o.area] ?? o.area}
                            {o.link && (
                              <>
                                {" · "}
                                <a href={o.link} target="_blank" rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 font-semibold text-[var(--accent)] hover:underline">
                                  <ExternalLink className="w-3 h-3" /> texto completo
                                </a>
                              </>
                            )}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}

            {filtradas.length > quantas && (
              <div className="mt-8 text-center">
                <button
                  type="button"
                  onClick={() => setQuantas((q) => q + LOTE)}
                  className="px-5 py-2 rounded-lg border border-[var(--border)] text-[13px] font-semibold text-[var(--accent)] hover:border-[var(--heading)]"
                >
                  Mostrar mais ({filtradas.length - quantas} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};
