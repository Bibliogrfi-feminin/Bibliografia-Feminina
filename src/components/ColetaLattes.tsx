import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Download, ExternalLink, FileSpreadsheet, Loader2, Play,
  Square, SkipForward, UploadCloud, X, RotateCcw, Puzzle, ChevronDown, Trash2, Search, Replace, Plus,
} from "lucide-react";
import { useAuth } from "../lib/AuthContext";
import { supabase } from "../lib/supabase";
import { lerCurriculoHtml } from "../lib/lattes";
import {
  apagarLote, apagarSigla, chaveSigla, listarSiglas, salvarSigla, type Siglas, criarLote, exportarLote, gravarColeta, lerPlanilha, listarItens, listarLotes,
  marcarErro, obrasPropostas, propostaDeCampos, proximoDaFila, revisaoPadrao, salvarRevisao,
  temConflito, type CampoProposto, type ItemColeta, type Lote, type PlanilhaLida, type StatusItem,
} from "../lib/coletaLattes";

/**
 * Coleta Lattes.
 *
 * O portal abre o currículo numa janela própria; a anotadora resolve o
 * captcha; o userscript (public/coleta-lattes.user.js) devolve a página;
 * o portal lê, grava e leva a mesma janela para o próximo da fila. Nada
 * aqui tenta passar pelo captcha — ele é a única parte manual, e é de
 * propósito.
 */

const ORIGENS_LATTES = ["https://buscatextual.cnpq.br", "http://buscatextual.cnpq.br"];
const ESPERA_SCRIPT_MS = 25000;

const ROTULO_STATUS: Record<StatusItem, string> = {
  PENDENTE: "Pendente", COLETADO: "Coletado", REVISADO: "Revisado", ERRO: "Erro", SEM_LATTES: "Sem Lattes",
};
const COR_STATUS: Record<StatusItem, string> = {
  PENDENTE: "bg-slate-100 text-slate-700 border-slate-200",
  COLETADO: "bg-amber-50 text-amber-800 border-amber-200",
  REVISADO: "bg-emerald-50 text-emerald-800 border-emerald-200",
  ERRO: "bg-red-50 text-red-800 border-red-200",
  SEM_LATTES: "bg-white text-[var(--text-muted)] border-[var(--border)]",
};

const linkDoItem = (it: ItemColeta) => (it.lattes_id ? `http://lattes.cnpq.br/${it.lattes_id}` : it.link ?? "");

// ====================================================================== tela

export const ColetaLattes = () => {
  const { user } = useAuth();
  const ehAdmin = user?.role === "ADMIN";
  const [lotes, setLotes] = useState<Lote[] | null>(null);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemColeta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);

  const lote = lotes?.find((l) => l.id === loteId) ?? null;

  const carregarLotes = useCallback(async () => {
    try {
      const ls = await listarLotes();
      setLotes(ls);
      setLoteId((atual) => atual ?? ls[0]?.id ?? null);
      if (ls.length === 0) setNovo(true);
    } catch (e: any) { setErro(e.message); }
  }, []);

  useEffect(() => { carregarLotes(); }, [carregarLotes]);

  useEffect(() => {
    if (!loteId) { setItens(null); return; }
    setItens(null);
    listarItens(loteId).then(setItens).catch((e) => setErro(e.message));
  }, [loteId]);

  const atualizarItem = useCallback((novoItem: ItemColeta) => {
    setItens((xs) => xs?.map((x) => (x.id === novoItem.id ? novoItem : x)) ?? xs);
  }, []);

  return (
    <div className="space-y-6">
      <ComoFunciona />

      {erro && <Erro texto={erro} fechar={() => setErro(null)} />}

      <div className="bg-white p-5 rounded-xl border border-[var(--border)] flex flex-wrap items-center gap-3">
        <FileSpreadsheet className="w-5 h-5 text-[var(--accent)]" />
        {lotes === null ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : lotes.length > 0 ? (
          <select value={loteId ?? ""} onChange={(e) => { setLoteId(e.target.value); setNovo(false); }}
            className="border border-[var(--border)] rounded-lg px-3 py-2 text-sm bg-white min-w-64">
            {lotes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nome} — {new Date(l.criado_em).toLocaleDateString("pt-BR")}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-[var(--text-muted)]">Nenhum lote ainda.</span>
        )}
        <button onClick={() => setNovo(!novo)}
          className="ml-auto px-4 py-2 text-sm font-bold rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--bg)] transition flex items-center gap-2">
          <UploadCloud className="w-4 h-4" /> Novo lote
        </button>
      </div>

      {novo && (
        <NovoLote
          cancelar={lotes && lotes.length > 0 ? () => setNovo(false) : undefined}
          criado={async (l) => { setNovo(false); await carregarLotes(); setLoteId(l.id); }}
        />
      )}

      {lote && !novo && (
        itens === null
          ? <div className="p-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>
          : <PainelLote lote={lote} itens={itens} atualizarItem={atualizarItem}
              recarregar={() => listarItens(lote.id).then(setItens)}
              apagar={ehAdmin ? async () => {
                if (!window.confirm(`Apagar o lote "${lote.nome}" e tudo que foi coletado nele?`)) return;
                await apagarLote(lote.id);
                setLoteId(null);
                await carregarLotes();
              } : undefined} />
      )}
    </div>
  );
};

// ============================================================ como funciona

function ComoFunciona() {
  const [aberto, setAberto] = useState(() => {
    try { return localStorage.getItem("bpf-coleta-ajuda") !== "fechada"; } catch { return true; }
  });
  const alternar = () => {
    setAberto(!aberto);
    try { localStorage.setItem("bpf-coleta-ajuda", aberto ? "fechada" : "aberta"); } catch { /* sem storage */ }
  };
  return (
    <div className="bg-white rounded-xl border border-[var(--border)]">
      <button onClick={alternar} className="w-full flex items-center gap-2 p-5 text-left">
        <Puzzle className="w-5 h-5 text-[var(--accent)]" />
        <span className="font-bold text-[var(--text-main)]">Como funciona a coleta</span>
        <ChevronDown className={`w-4 h-4 ml-auto transition ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="px-5 pb-5 text-sm text-[var(--text-muted)] space-y-3">
          <ol className="list-decimal pl-5 space-y-2">
            <li>
              Uma vez por computador: instale a extensão <strong>Tampermonkey</strong> no Chrome e, nos detalhes
              da extensão, ative <strong>"Permitir scripts do usuário"</strong>. Depois clique em{" "}
              <a href="/coleta-lattes.user.js" target="_blank" rel="noreferrer"
                className="text-[var(--accent)] font-bold hover:underline">instalar o script da coleta</a>{" "}
              e confirme na tela do Tampermonkey.
            </li>
            <li>Suba a planilha de mapeamento em <strong>Novo lote</strong>. Cada linha com link do Lattes entra na fila.</li>
            <li>
              Clique em <strong>Começar coleta</strong>. Abre uma janela com o primeiro currículo: resolva o captcha
              ("Não sou um robô"). O portal lê o currículo, grava e abre o próximo sozinho.
            </li>
            <li>
              Na lista, <strong>Revisar</strong> mostra campo a campo o que veio do Lattes ao lado do que já estava na
              planilha. O que estava em branco já vem marcado; o que é diferente espera você decidir.
            </li>
            <li>
              <strong>Baixar planilha</strong> devolve a ABA 1 nas mesmas linhas e colunas (só com o que foi revisado)
              e a ABA 2 com as obras de {2015} em diante, para a classificação manual.
            </li>
          </ol>
          <p className="text-xs">
            Mais de uma pessoa pode coletar ao mesmo tempo no mesmo lote: cada uma recebe currículos diferentes.
            O e-mail não sai do Lattes (o CNPq não publica).
          </p>
        </div>
      )}
    </div>
  );
}

// ================================================================ novo lote

function NovoLote({ cancelar, criado }: { cancelar?: () => void; criado: (l: Lote) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lida, setLida] = useState<PlanilhaLida | null>(null);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const escolher = async (f: File | null) => {
    setArquivo(f); setLida(null); setErro(null);
    if (!f) return;
    setNome(f.name.replace(/\.xlsx$/i, ""));
    setOcupado(true);
    try { setLida(await lerPlanilha(f)); }
    catch (e: any) { setErro(e.message); }
    finally { setOcupado(false); }
  };

  const criar = async () => {
    if (!lida || !arquivo) return;
    setOcupado(true); setErro(null);
    try { criado(await criarLote(nome.trim() || arquivo.name, arquivo.name, lida)); }
    catch (e: any) { setErro(e.message); setOcupado(false); }
  };

  const comLattes = lida?.linhas.filter((l) => l.lattesId).length ?? 0;

  return (
    <div className="bg-white p-6 rounded-xl border border-[var(--border)] space-y-4">
      <div className="flex items-center">
        <h4 className="font-bold text-[var(--text-main)]">Novo lote de coleta</h4>
        {cancelar && <button onClick={cancelar} className="ml-auto text-[var(--text-muted)]"><X className="w-4 h-4" /></button>}
      </div>

      <label className="block border-2 border-dashed border-[var(--border)] rounded-xl p-8 text-center cursor-pointer hover:border-[var(--accent)] transition">
        <input type="file" accept=".xlsx" className="hidden" onChange={(e) => escolher(e.target.files?.[0] || null)} />
        <UploadCloud className="w-8 h-8 mb-2 mx-auto text-[var(--text-muted)]" />
        <p className="font-bold text-[var(--text-main)]">{arquivo ? arquivo.name : "Escolher a planilha de mapeamento (.xlsx)"}</p>
        <p className="text-xs text-[var(--text-muted)]">A ABA 1 precisa ter a coluna "Link do currículo Lattes".</p>
      </label>

      {ocupado && !lida && <p className="text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Lendo a planilha…</p>}
      {erro && <Erro texto={erro} />}

      {lida && (
        <>
          <div className="grid grid-cols-3 gap-3 text-center text-xs">
            <Numero valor={lida.linhas.length} rotulo="linhas na ABA 1" />
            <Numero valor={comLattes} rotulo="com link do Lattes" destaque />
            <Numero valor={lida.linhas.length - comLattes} rotulo="sem link (ficam de fora)" />
          </div>
          {lida.repetidos.size > 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3">
              <p className="font-bold mb-1">{lida.repetidos.size} links do Lattes aparecem em mais de uma linha:</p>
              <ul className="list-disc pl-4 max-h-32 overflow-y-auto">
                {[...lida.repetidos].map(([id, nomes]) => <li key={id}>{nomes.join(" · ")}</li>)}
              </ul>
              <p className="mt-1">Quando são pessoas diferentes, um dos links está errado na planilha.</p>
            </div>
          )}
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex-1 min-w-56">
              <span className="block text-xs font-bold text-[var(--text-muted)] mb-1">Nome do lote</span>
              <input value={nome} onChange={(e) => setNome(e.target.value)}
                className="w-full border border-[var(--border)] rounded-lg px-3 py-2 text-sm" />
            </label>
            <button disabled={ocupado || comLattes === 0} onClick={criar}
              className="px-5 py-2.5 bg-[var(--accent)] text-white font-bold rounded-lg hover:bg-[var(--accent-hover)] transition disabled:opacity-60 flex items-center gap-2">
              {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Criar lote com {comLattes} currículos
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// =================================================================== painel

function PainelLote({ lote, itens, atualizarItem, recarregar, apagar }: {
  lote: Lote; itens: ItemColeta[]; atualizarItem: (i: ItemColeta) => void;
  recarregar: () => Promise<void>; apagar?: () => Promise<void>;
}) {
  const [filtro, setFiltro] = useState<StatusItem | "TODOS" | "CONFLITO">("TODOS");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(100);
  const [revisando, setRevisando] = useState<ItemColeta | null>(null);
  const [aprovando, setAprovando] = useState<{ feitos: number; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const coleta = useColeta(lote, atualizarItem);
  const [siglas, setSiglas] = useState<Siglas>(new Map());
  const carregarSiglas = useCallback(() => listarSiglas().then(setSiglas).catch((e) => setErro(e.message)), []);
  useEffect(() => { carregarSiglas(); }, [carregarSiglas]);

  const contagem = useMemo(() => {
    const c: Record<StatusItem, number> = { PENDENTE: 0, COLETADO: 0, REVISADO: 0, ERRO: 0, SEM_LATTES: 0 };
    for (const i of itens) c[i.status]++;
    return c;
  }, [itens]);
  const naFila = itens.length - contagem.SEM_LATTES;
  const feitos = contagem.COLETADO + contagem.REVISADO;

  const semConflito = useMemo(
    () => itens.filter((i) => i.status === "COLETADO" && !temConflito(i, lote.colunas, siglas)),
    [itens, lote.colunas, siglas]
  );

  const visiveis = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return itens.filter((i) => {
      if (filtro === "CONFLITO") { if (!(i.status === "COLETADO" && temConflito(i, lote.colunas, siglas))) return false; }
      else if (filtro !== "TODOS" && i.status !== filtro) return false;
      return !b || i.nome.toLowerCase().includes(b) || (i.lattes_id ?? "").includes(b);
    });
  }, [itens, filtro, busca, lote.colunas, siglas]);

  const aprovarEmLote = async () => {
    if (!window.confirm(
      `Aprovar ${semConflito.length} currículos sem conflito? Entra só o que preenche célula vazia na planilha (e a data de atualização), mais as obras dentro do recorte.`
    )) return;
    setAprovando({ feitos: 0, total: semConflito.length });
    try {
      for (let k = 0; k < semConflito.length; k++) {
        const it = semConflito[k];
        atualizarItem(await salvarRevisao(it, revisaoPadrao(it, lote.colunas, siglas)));
        setAprovando({ feitos: k + 1, total: semConflito.length });
      }
    } catch (e: any) { setErro(e.message); }
    finally { setAprovando(null); }
  };

  return (
    <div className="space-y-5">
      {/* números */}
      <div className="bg-white p-5 rounded-xl border border-[var(--border)] space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center text-xs">
          <Numero valor={contagem.PENDENTE} rotulo="pendentes" />
          <Numero valor={contagem.COLETADO} rotulo="coletados (a revisar)" />
          <Numero valor={contagem.REVISADO} rotulo="revisados" destaque />
          <Numero valor={contagem.ERRO} rotulo="com erro" />
          <Numero valor={contagem.SEM_LATTES} rotulo="sem Lattes" />
        </div>
        <div className="h-2 bg-[var(--bg)] rounded-full overflow-hidden border border-[var(--border)]">
          <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${naFila ? (feitos / naFila) * 100 : 0}%` }} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => coleta.comecar()} disabled={coleta.ativo || contagem.PENDENTE + contagem.ERRO === 0}
            className="px-4 py-2 bg-[var(--accent)] text-white text-sm font-bold rounded-lg hover:bg-[var(--accent-hover)] transition disabled:opacity-50 flex items-center gap-2">
            <Play className="w-4 h-4" /> Começar coleta
          </button>
          <button onClick={aprovarEmLote} disabled={!!aprovando || semConflito.length === 0}
            className="px-4 py-2 text-sm font-bold rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] transition disabled:opacity-50 flex items-center gap-2">
            {aprovando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            {aprovando ? `Aprovando ${aprovando.feitos}/${aprovando.total}` : `Aprovar ${semConflito.length} sem conflito`}
          </button>
          <button onClick={() => exportarLote(lote, itens).catch((e) => setErro(e.message))}
            className="px-4 py-2 text-sm font-bold rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] transition flex items-center gap-2">
            <Download className="w-4 h-4" /> Baixar planilha
          </button>
          <button onClick={() => recarregar().catch((e) => setErro(e.message))} title="Atualizar a lista (ver o que outras pessoas coletaram)"
            className="px-3 py-2 text-sm rounded-lg border border-[var(--border)] hover:bg-[var(--bg)] transition">
            <RotateCcw className="w-4 h-4" />
          </button>
          {apagar && (
            <button onClick={() => apagar().catch((e) => setErro(e.message))} title="Apagar lote"
              className="ml-auto px-3 py-2 text-sm rounded-lg border border-red-200 text-red-700 hover:bg-red-50 transition">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {erro && <Erro texto={erro} fechar={() => setErro(null)} />}
      {coleta.ativo && <SessaoColeta coleta={coleta} />}
      <Equivalencias siglas={siglas} mudou={carregarSiglas} />

      {/* lista */}
      <div className="bg-white rounded-xl border border-[var(--border)]">
        <div className="p-4 flex flex-wrap gap-2 items-center border-b border-[var(--border)]">
          {(["TODOS", "PENDENTE", "COLETADO", "CONFLITO", "REVISADO", "ERRO", "SEM_LATTES"] as const).map((f) => (
            <button key={f} onClick={() => { setFiltro(f); setLimite(100); }}
              className={`px-3 py-1 rounded-full text-xs font-bold border transition ${
                filtro === f ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-main)]"
              }`}>
              {f === "TODOS" ? "Todos" : f === "CONFLITO" ? "Com conflito" : ROTULO_STATUS[f]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-1.5">
            <Search className="w-4 h-4 text-[var(--text-muted)]" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou ID Lattes"
              className="text-sm outline-none w-44" />
          </label>
        </div>
        <ul className="divide-y divide-[var(--border)]">
          {visiveis.slice(0, limite).map((it) => (
            <li key={it.id} className="px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
              <span className="w-12 text-xs text-[var(--text-muted)]">L{it.linha}</span>
              <span className="flex-1 min-w-48 font-semibold text-[var(--text-main)]">{it.nome}</span>
              {it.coletado?.avisos.length ? (
                <span title={it.coletado.avisos.join("\n")} className="text-amber-700 flex items-center gap-1 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" /> {it.coletado.avisos.length}
                </span>
              ) : null}
              {it.status === "ERRO" && <span className="text-xs text-red-700 max-w-64 truncate" title={it.erro ?? ""}>{it.erro}</span>}
              <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${COR_STATUS[it.status]}`}>
                {ROTULO_STATUS[it.status]}
              </span>
              {it.lattes_id && (
                <a href={linkDoItem(it)} target="_blank" rel="noreferrer" title="Abrir o Lattes"
                  className="text-[var(--text-muted)] hover:text-[var(--accent)]"><ExternalLink className="w-4 h-4" /></a>
              )}
              {it.lattes_id && !coleta.ativo && (
                <button onClick={() => coleta.comecar(it)} title="Coletar só este currículo (de novo)"
                  className="text-[var(--text-muted)] hover:text-[var(--accent)]"><Play className="w-4 h-4" /></button>
              )}
              {(it.status === "COLETADO" || it.status === "REVISADO") && (
                <button onClick={() => setRevisando(it)}
                  className="px-3 py-1 text-xs font-bold rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--bg)]">
                  {it.status === "REVISADO" ? "Rever" : "Revisar"}
                </button>
              )}
            </li>
          ))}
          {visiveis.length === 0 && <li className="p-6 text-center text-sm text-[var(--text-muted)]">Nada aqui.</li>}
        </ul>
        {visiveis.length > limite && (
          <button onClick={() => setLimite(limite + 200)} className="w-full p-3 text-sm font-bold text-[var(--accent)] border-t border-[var(--border)]">
            Mostrar mais ({visiveis.length - limite} restantes)
          </button>
        )}
      </div>

      {revisando && (
        <Revisao item={revisando} lote={lote} siglas={siglas} aprendeu={carregarSiglas} fechar={() => setRevisando(null)}
          salvo={(i) => { atualizarItem(i); setRevisando(null); }} />
      )}
    </div>
  );
}

// ================================================================== coleta

type Fase = "abrindo" | "captcha" | "lendo" | "gravado" | "sem-script" | "erro" | "fim";

function useColeta(lote: Lote, atualizarItem: (i: ItemColeta) => void) {
  const [ativo, setAtivo] = useState(false);
  const [item, setItem] = useState<ItemColeta | null>(null);
  const [fase, setFase] = useState<Fase>("abrindo");
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [nesta, setNesta] = useState(0);

  const janela = useRef<Window | null>(null);
  const itemRef = useRef<ItemColeta | null>(null);
  const unico = useRef(false); // coletar um currículo só
  const espera = useRef<number | null>(null);
  const ocupado = useRef(false);

  const limparEspera = () => { if (espera.current) { clearTimeout(espera.current); espera.current = null; } };

  const abrir = useCallback((it: ItemColeta) => {
    itemRef.current = it;
    setItem(it);
    setFase("abrindo");
    setMensagem(null);
    ocupado.current = false;
    if (!janela.current || janela.current.closed) return;
    janela.current.location.href = linkDoItem(it);
    limparEspera();
    espera.current = window.setTimeout(() => setFase((f) => (f === "abrindo" ? "sem-script" : f)), ESPERA_SCRIPT_MS);
  }, []);

  const parar = useCallback(async () => {
    limparEspera();
    setAtivo(false);
    const it = itemRef.current;
    itemRef.current = null;
    setItem(null);
    // devolve à fila o que estava reservado e não foi coletado
    if (it) {
      await supabase.from("coleta_itens").update({ reservado_por: null, reservado_em: null })
        .eq("id", it.id).eq("status", "PENDENTE");
    }
  }, []);

  const avancar = useCallback(async (pular?: string) => {
    if (unico.current) { setFase("fim"); setMensagem("Currículo coletado."); return; }
    try {
      const prox = await proximoDaFila(lote.id, pular);
      if (!prox) { itemRef.current = null; setItem(null); setFase("fim"); setMensagem("A fila deste lote acabou."); return; }
      abrir(prox);
    } catch (e: any) { setFase("erro"); setMensagem(e.message); }
  }, [lote.id, abrir]);

  const comecar = useCallback((especifico?: ItemColeta) => {
    // a janela abre já, dentro do clique: depois de um await o navegador
    // trataria como pop-up não pedido e bloquearia
    const w = window.open("about:blank", "bpf-coleta-lattes");
    if (!w) { setAtivo(true); setFase("erro"); setMensagem("O navegador bloqueou a janela. Permita pop-ups para este site e tente de novo."); return; }
    janela.current = w;
    unico.current = !!especifico;
    setAtivo(true);
    setNesta(0);
    if (especifico) abrir(especifico); else avancar();
  }, [abrir, avancar]);

  // mensagens do userscript
  useEffect(() => {
    if (!ativo) return;
    const responder = (tipo: "gravado" | "erro", texto: string, origem: string) => {
      try { janela.current?.postMessage({ origem: "bpf-portal", tipo, texto }, origem); } catch { /* fechada */ }
    };

    const aoReceber = async (e: MessageEvent) => {
      if (e.source !== janela.current || !ORIGENS_LATTES.includes(e.origin)) return;
      const d = e.data;
      if (!d || d.origem !== "bpf-coleta-lattes") return;
      const it = itemRef.current;
      if (!it) return;

      if (d.tipo === "captcha") { limparEspera(); setFase("captcha"); return; }
      if (d.tipo !== "curriculo" || typeof d.html !== "string" || ocupado.current) return;

      ocupado.current = true;
      limparEspera();
      setFase("lendo");
      try {
        const cv = lerCurriculoHtml(d.html);
        if (!cv.nome && !cv.idLattes) throw new Error("A página não parece um currículo Lattes.");
        const salvo = await gravarColeta(it, cv);
        atualizarItem(salvo);
        setNesta((n) => n + 1);
        setFase("gravado");
        setMensagem(`${salvo.nome}: ${cv.obras.filter((o) => !o.foraDoRecorte).length} obras desde 2015.`);
        responder("gravado", `${salvo.nome} gravada. ${unico.current ? "Pode fechar esta janela." : "Abrindo a próxima…"}`, e.origin);
        window.setTimeout(() => avancar(), 900);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        setFase("erro");
        setMensagem(msg);
        responder("erro", msg, e.origin);
        await marcarErro(it, msg).catch(() => {});
        atualizarItem({ ...it, status: "ERRO", erro: msg });
        ocupado.current = false;
      }
    };

    window.addEventListener("message", aoReceber);
    // fechou a janela: a coleta para
    const vigia = window.setInterval(() => { if (janela.current?.closed) parar(); }, 1500);
    return () => { window.removeEventListener("message", aoReceber); clearInterval(vigia); };
  }, [ativo, atualizarItem, avancar, parar]);

  useEffect(() => () => limparEspera(), []);

  return {
    ativo, item, fase, mensagem, nesta, comecar, parar,
    pular: () => { const it = itemRef.current; if (it) avancar(it.id); },
    tentarDeNovo: () => { const it = itemRef.current; if (it) abrir(it); },
    focar: () => janela.current?.focus(),
  };
}

function SessaoColeta({ coleta }: { coleta: ReturnType<typeof useColeta> }) {
  const { fase, item, mensagem, nesta } = coleta;
  const texto: Record<Fase, string> = {
    abrindo: "Abrindo o currículo…",
    captcha: "Resolva o captcha na janela do Lattes.",
    lendo: "Lendo e gravando…",
    gravado: "Gravado.",
    "sem-script": "O script da coleta não respondeu. Ele está instalado e ativo no Tampermonkey? (veja \"Como funciona\")",
    erro: "Algo deu errado.",
    fim: "Fim.",
  };
  const cor = fase === "erro" || fase === "sem-script" ? "border-red-300 bg-red-50"
    : fase === "captcha" ? "border-amber-300 bg-amber-50" : "border-[var(--accent)] bg-white";

  return (
    <div className={`p-5 rounded-xl border-2 ${cor} space-y-3`}>
      <div className="flex flex-wrap items-center gap-3">
        {(fase === "abrindo" || fase === "lendo") && <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />}
        {fase === "captcha" && <AlertTriangle className="w-5 h-5 text-amber-700" />}
        {fase === "gravado" && <CheckCircle2 className="w-5 h-5 text-emerald-700" />}
        <div className="flex-1 min-w-56">
          <p className="font-bold text-[var(--text-main)]">{texto[fase]}</p>
          {item && <p className="text-sm text-[var(--text-muted)]">L{item.linha} · {item.nome}</p>}
          {mensagem && <p className="text-sm mt-1">{mensagem}</p>}
        </div>
        <span className="text-xs text-[var(--text-muted)]">{nesta} nesta sessão</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {fase === "captcha" && (
          <button onClick={coleta.focar} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 text-white">
            Ir para a janela do Lattes
          </button>
        )}
        {(fase === "erro" || fase === "sem-script") && item && (
          <button onClick={coleta.tentarDeNovo} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border)] bg-white flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" /> Tentar de novo
          </button>
        )}
        {item && fase !== "fim" && (
          <button onClick={coleta.pular} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border)] bg-white flex items-center gap-1">
            <SkipForward className="w-3.5 h-3.5" /> Pular este
          </button>
        )}
        <button onClick={coleta.parar} className="px-3 py-1.5 text-xs font-bold rounded-lg border border-[var(--border)] bg-white flex items-center gap-1">
          <Square className="w-3.5 h-3.5" /> {fase === "fim" ? "Fechar" : "Parar"}
        </button>
      </div>
    </div>
  );
}

// ================================================================= revisão

function Revisao({ item, lote, siglas, aprendeu, fechar, salvo }: {
  item: ItemColeta; lote: Lote; siglas: Siglas; aprendeu: () => Promise<void>;
  fechar: () => void; salvo: (i: ItemColeta) => void;
}) {
  const cv = item.coletado!;
  const [campos, setCampos] = useState<CampoProposto[]>(() => {
    const p = propostaDeCampos(item, lote.colunas, siglas);
    // revendo: o que já foi aprovado volta marcado, com o valor aprovado
    if (item.revisao) return p.map((c) => c.coluna in item.revisao!.campos
      ? { ...c, usar: true, lattes: item.revisao!.campos[c.coluna] } : { ...c, usar: false });
    return p;
  });
  const [obras, setObras] = useState(() => {
    const p = obrasPropostas(item);
    if (!item.revisao) return p;
    const aprovadas = new Set(item.revisao.obras.map((o) => o.citacao));
    return p.map((o) => ({ ...o, usar: aprovadas.has(o.citacao) }));
  });
  const [mostrarFora, setMostrarFora] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * "Sempre ler FDUSP como USP": grava na tabela e refaz só as linhas de
   * faculdade com a mesma sigla, sem perder o que já foi mexido nas outras.
   */
  const lembrar = async (bruto: string, para: string) => {
    setErro(null);
    try {
      await salvarSigla(bruto, para);
      const novas = new Map(siglas).set(chaveSigla(bruto), para.trim());
      const refeitas = propostaDeCampos(item, lote.colunas, novas);
      setCampos((atuais) => atuais.map((c) =>
        c.bruto !== undefined && chaveSigla(c.bruto) === chaveSigla(bruto)
          ? refeitas.find((r) => r.chave === c.chave) ?? c : c));
      await aprendeu();
    } catch (e: any) { setErro(e.message); }
  };

  const salvar = async () => {
    setOcupado(true); setErro(null);
    try {
      const revisao = {
        campos: Object.fromEntries(campos.filter((c) => c.usar).map((c) => [c.coluna, c.lattes])),
        obras: obras.filter((o) => o.usar).map((o) => ({ citacao: o.citacao, ano: o.ano ?? "", secao: o.secao, tipoSugerido: o.tipoSugerido })),
      };
      salvo(await salvarRevisao(item, revisao));
    } catch (e: any) { setErro(e.message); setOcupado(false); }
  };

  const dentro = obras.filter((o) => !o.foraDoRecorte);
  const fora = obras.filter((o) => o.foraDoRecorte);
  const marcadas = obras.filter((o) => o.usar).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto" onClick={fechar}>
      <div className="bg-white rounded-xl w-full max-w-5xl my-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-5 border-b border-[var(--border)] flex items-start gap-3">
          <div className="flex-1">
            <h3 className="font-serif italic text-lg text-[var(--text-main)]">{item.nome}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Linha {item.linha} · Lattes {cv.idLattes ?? item.lattes_id}
              {cv.nome && cv.nome.toLowerCase() !== item.nome.trim().toLowerCase() ? ` · no Lattes: ${cv.nome}` : ""}
              {" · "}<a href={linkDoItem(item)} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">abrir currículo</a>
            </p>
          </div>
          <button onClick={fechar} className="text-[var(--text-muted)]"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-6">
          {(cv.avisos.length > 0 || cv.emAndamento.length > 0) && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 space-y-1">
              {cv.avisos.map((a, i) => <p key={i} className="flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{a}</p>)}
              {cv.emAndamento.map((a, i) => <p key={`and${i}`}>Em andamento (não conta como titulação): {a}</p>)}
            </div>
          )}

          <section>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">ABA 1 — campo a campo</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--text-muted)]">
                    <th className="p-2 w-8"></th><th className="p-2">Campo</th><th className="p-2">Na planilha</th><th className="p-2">Do Lattes (editável)</th>
                  </tr>
                </thead>
                <tbody>
                  {campos.map((c, k) => (
                    <tr key={c.chave} className={`border-t border-[var(--border)] ${c.situacao === "diferente" ? "bg-amber-50/60" : ""}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={c.usar} disabled={c.situacao === "igual"}
                          onChange={(e) => setCampos(campos.map((x, j) => (j === k ? { ...x, usar: e.target.checked } : x)))} />
                      </td>
                      <td className="p-2 text-xs font-bold text-[var(--text-main)] whitespace-nowrap">{c.rotulo}</td>
                      <td className="p-2 text-xs text-[var(--text-muted)]">{c.atual || <em>vazio</em>}</td>
                      <td className="p-2">
                        {c.situacao === "igual"
                          ? <span className="text-xs text-emerald-700">igual</span>
                          : <input value={c.lattes}
                              onChange={(e) => setCampos(campos.map((x, j) => (j === k ? { ...x, lattes: e.target.value, usar: true } : x)))}
                              className="w-full border border-[var(--border)] rounded px-2 py-1 text-xs" />}
                        <Lembrar campo={c} siglas={siglas} lembrar={lembrar} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
              ABA 2 — obras ({marcadas} marcadas de {dentro.length} desde 2015)
            </h4>
            <ListaObras visiveis={dentro} alternar={(o, v) => setObras(obras.map((x) => (x === o ? { ...x, usar: v } : x)))} />
            {fora.length > 0 && (
              <>
                <button onClick={() => setMostrarFora(!mostrarFora)} className="mt-2 text-xs font-bold text-[var(--accent)] hover:underline">
                  {mostrarFora ? "Ocultar" : "Ver"} as {fora.length} fora do recorte (antes de 2015, sem ano ou apresentações)
                </button>
                {mostrarFora && <ListaObras visiveis={fora} alternar={(o, v) => setObras(obras.map((x) => (x === o ? { ...x, usar: v } : x)))} />}
              </>
            )}
          </section>

          {erro && <Erro texto={erro} />}
        </div>

        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={fechar} className="px-4 py-2 text-sm font-bold rounded-lg border border-[var(--border)]">Cancelar</button>
          <button onClick={salvar} disabled={ocupado}
            className="px-5 py-2 bg-[var(--accent)] text-white text-sm font-bold rounded-lg hover:bg-[var(--accent-hover)] disabled:opacity-60 flex items-center gap-2">
            {ocupado ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Aprovar revisão
          </button>
        </div>
      </div>
    </div>
  );
}

type ObraMarcavel = ReturnType<typeof obrasPropostas>[number];

function ListaObras({ visiveis, alternar }: {
  visiveis: ObraMarcavel[]; alternar: (o: ObraMarcavel, v: boolean) => void;
}) {
  if (visiveis.length === 0) return <p className="text-xs text-[var(--text-muted)]">Nenhuma.</p>;
  return (
    <ul className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] max-h-96 overflow-y-auto">
      {visiveis.map((o, i) => (
        <li key={i} className="p-3 flex gap-3 text-xs">
          <input type="checkbox" checked={o.usar} onChange={(e) => alternar(o, e.target.checked)} className="mt-0.5" />
          <div className="flex-1">
            <p className="text-[var(--text-main)]">{o.citacao}</p>
            <p className="text-[var(--text-muted)] mt-1">{o.ano ?? "sem ano"} · {o.secao}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ============================================================== siglas

/**
 * Atalho na linha de faculdade: o Lattes disse "FDUSP", a planilha (ou
 * quem revisa) diz "USP" — guardar a equivalência para as próximas.
 */
function Lembrar({ campo: c, siglas, lembrar }: {
  campo: CampoProposto; siglas: Siglas; lembrar: (bruto: string, para: string) => Promise<void>;
}) {
  if (!c.bruto || c.situacao === "igual") return null;
  // o valor que a pessoa está escolhendo: o editado, se marcou; senão o da planilha
  const para = (c.usar ? c.lattes : c.atual).trim();
  if (!para || para === "N/A" || chaveSigla(para) === chaveSigla(c.bruto)) return null;
  if (siglas.get(chaveSigla(c.bruto)) === para) return null;
  return (
    <button onClick={() => lembrar(c.bruto!, para)}
      className="mt-1 text-[11px] font-bold text-[var(--accent)] hover:underline flex items-center gap-1">
      <Replace className="w-3 h-3" /> Sempre ler "{c.bruto}" como "{para}"
    </button>
  );
}

function Equivalencias({ siglas, mudou }: { siglas: Siglas; mudou: () => Promise<void> }) {
  const [aberto, setAberto] = useState(false);
  const [de, setDe] = useState("");
  const [para, setPara] = useState("");
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const adicionar = async () => {
    setErro(null);
    try { await salvarSigla(de, para); setDe(""); setPara(""); await mudou(); }
    catch (e: any) { setErro(e.message); }
  };
  const remover = async (chave: string) => {
    setErro(null);
    try { await apagarSigla(chave); await mudou(); }
    catch (e: any) { setErro(e.message); }
  };

  const b = chaveSigla(busca);
  const lista = [...siglas].filter(([k, v]) => !b || k.includes(b) || chaveSigla(v).includes(b));

  return (
    <div className="bg-white rounded-xl border border-[var(--border)]">
      <button onClick={() => setAberto(!aberto)} className="w-full flex items-center gap-2 p-4 text-left">
        <Replace className="w-4 h-4 text-[var(--accent)]" />
        <span className="font-bold text-sm text-[var(--text-main)]">Equivalência de siglas</span>
        <span className="text-xs text-[var(--text-muted)]">
          ({siglas.size}) · como o Lattes escreve a instituição × como a planilha escreve
        </span>
        <ChevronDown className={`w-4 h-4 ml-auto transition ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto && (
        <div className="px-4 pb-4 space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            Pontuação, espaços e acentos não contam: "PUC-SP", "PUC/SP" e "PUCSP" são a mesma sigla.
            Vale para todos os lotes, inclusive o que já foi coletado.
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <label className="text-xs">
              <span className="block font-bold text-[var(--text-muted)] mb-1">No Lattes</span>
              <input value={de} onChange={(e) => setDe(e.target.value)} placeholder="FDUSP"
                className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm w-40" />
            </label>
            <label className="text-xs">
              <span className="block font-bold text-[var(--text-muted)] mb-1">Na planilha</span>
              <input value={para} onChange={(e) => setPara(e.target.value)} placeholder="USP"
                className="border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm w-40" />
            </label>
            <button onClick={adicionar} disabled={!de.trim() || !para.trim()}
              className="px-3 py-2 text-xs font-bold rounded-lg bg-[var(--accent)] text-white disabled:opacity-50 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Adicionar
            </button>
            <label className="ml-auto flex items-center gap-2 border border-[var(--border)] rounded-lg px-3 py-1.5">
              <Search className="w-4 h-4 text-[var(--text-muted)]" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar"
                className="text-sm outline-none w-28" />
            </label>
          </div>
          {erro && <Erro texto={erro} fechar={() => setErro(null)} />}
          <ul className="border border-[var(--border)] rounded-lg divide-y divide-[var(--border)] max-h-64 overflow-y-auto text-sm">
            {lista.map(([k, v]) => (
              <li key={k} className="px-3 py-1.5 flex items-center gap-3">
                <span className="font-mono text-xs w-56 truncate" title={k}>{k}</span>
                <span className="text-[var(--text-muted)]">→</span>
                <span className="font-bold flex-1">{v}</span>
                <button onClick={() => remover(k)} title="Remover" className="text-[var(--text-muted)] hover:text-red-700">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
            {lista.length === 0 && <li className="p-3 text-xs text-[var(--text-muted)]">Nenhuma.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

// ============================================================== miudezas

function Numero({ valor, rotulo, destaque }: { valor: number; rotulo: string; destaque?: boolean }) {
  return (
    <div className={`p-3 rounded-lg border ${destaque ? "bg-emerald-50 border-emerald-100" : "bg-[var(--bg)] border-[var(--border)]"}`}>
      <div className={`text-lg font-serif ${destaque ? "text-emerald-700" : "text-[var(--text-main)]"}`}>{valor}</div>
      <div className={destaque ? "text-emerald-700" : "text-[var(--text-muted)]"}>{rotulo}</div>
    </div>
  );
}

function Erro({ texto, fechar }: { texto: string; fechar?: () => void }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800 flex gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span className="flex-1">{texto}</span>
      {fechar && <button onClick={fechar}><X className="w-4 h-4" /></button>}
    </div>
  );
}
