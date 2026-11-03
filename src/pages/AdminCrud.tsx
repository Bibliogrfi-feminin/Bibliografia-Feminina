import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/AuthContext";
import { Eye, Trash2, Edit, Plus, Search, X, Save } from "lucide-react";
import { baixarXlsx, deRegistros } from "../lib/xlsx";

/**
 * Excluir é irreversível e some com as obras junto (a chave estrangeira
 * é ON DELETE CASCADE). Anotadora cadastra e corrige; apagar é de ADMIN.
 */
const SoAdmin = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  return user?.role === "ADMIN" ? <>{children}</> : null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const LIMIT = 20;

const statusColors: Record<string, string> = {
  ATIVO: "bg-[var(--success-bg)] text-[var(--success)]",
  INCOMPLETO: "bg-[var(--warning-bg)] text-[var(--warning)]",
  REVISAR: "bg-[var(--warning-bg)] text-[var(--warning)]",
  DUPLICADO: "bg-[var(--error-bg)] text-[var(--error)]",
};

/**
 * Uma escrita barrada pelo RLS não dá erro: o UPDATE/DELETE só não acha
 * linha. Pedir as linhas de volta é o único jeito de saber que gravou —
 * sem isso, a tela fechava como se tivesse salvo e nada mudava.
 */
const gravou = async (q: any, acao: string): Promise<boolean> => {
  const { data, error } = await q.select("id");
  if (error || !data?.length) {
    alert(`Não foi possível ${acao}. ${error ? error.message : "Você pode não ter permissão para isso."}`);
    return false;
  }
  return true;
};

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

const Modal = ({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) => (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl border border-[var(--border)]">
      <div className="px-6 py-4 border-b flex justify-between items-center bg-[var(--bg)]">
        <h3 className="font-serif italic text-lg text-[var(--text-main)]">{title}</h3>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-black"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-6 max-h-[70vh] overflow-y-auto">{children}</div>
    </div>
  </div>
);

// ── Tab: Associadas ───────────────────────────────────────────────────────────

const AssociadasTab = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  const load = async () => {
    setLoading(true);
    // todos os campos que o formulário de edição mostra, ou ele os exibe vazios
    let q = supabase.from("associadas").select("id,nome,email,ibdp,abep,status_registro,uf_atuacao,atuacao_profissional,leciona,link_lattes,mestre,doutora,especialista,livre_docente", { count: "exact" }).is("deletado_em", null).order("nome");
    if (search) q = q.or(`nome.ilike.%${search}%,email.ilike.%${search}%`);
    const from = (page - 1) * LIMIT;
    q = q.range(from, from + LIMIT - 1);
    const { data: rows, count } = await q;
    setData(rows || []);
    setTotal(count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, search]);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este registro?")) return;
    if (await gravou(supabase.from("associadas").update({ deletado_em: new Date().toISOString() }).eq("id", id), "excluir o registro")) load();
  };

  const openEdit = (row: any) => { setEditing(row); setEditForm({ ...row }); };
  const closeEdit = () => setEditing(null);

  const saveEdit = async () => {
    const { id, ...payload } = editForm;
    if (!(await gravou(supabase.from("associadas").update(payload).eq("id", id), "salvar a edição"))) return;
    setEditing(null);
    load();
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-muted)]" />
          <input placeholder="Buscar por nome ou email..." className="pl-10 pr-4 py-2 w-full border border-[var(--border)] rounded-lg text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <span className="text-xs text-[var(--text-muted)]">{total} registros</span>
      </div>

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">UF</th>
                <th className="px-4 py-3">IBDP</th>
                <th className="px-4 py-3">ABEP</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-[var(--text-muted)]">Carregando...</td></tr>
              ) : data.map(row => (
                <tr key={row.id} className="hover:bg-[var(--row-hover)]">
                  <td className="px-4 py-3 font-semibold text-[var(--text-main)] max-w-[200px] truncate">{row.nome}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)] max-w-[180px] truncate">{row.email || "—"}</td>
                  <td className="px-4 py-3">{row.uf_atuacao || "—"}</td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.ibdp ? "bg-[var(--success-bg)] text-[var(--success)]" : "text-[var(--text-muted)]"}`}>{row.ibdp ? "SIM" : "NÃO"}</span></td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${row.abep ? "bg-[var(--success-bg)] text-[var(--success)]" : "text-[var(--text-muted)]"}`}>{row.abep ? "SIM" : "NÃO"}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusColors[row.status_registro] || ""}`}>{row.status_registro}</span></td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => navigate(`/consulta/${row.id}`)} className="p-1 text-[var(--text-muted)] hover:text-blue-600 transition" title="Ver detalhes"><Eye className="w-4 h-4" /></button>
                    <button onClick={() => openEdit(row)} className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)] transition" title="Editar"><Edit className="w-4 h-4" /></button>
                    <SoAdmin><button onClick={() => handleDelete(row.id)} className="p-1 text-[var(--text-muted)] hover:text-[var(--error)] transition" title="Excluir"><Trash2 className="w-4 h-4" /></button></SoAdmin>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-[var(--border)] flex justify-between items-center text-xs text-[var(--text-muted)]">
          <span>Página {page} de {totalPages || 1}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Anterior</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Próximo</button>
          </div>
        </div>
      </div>

      {editing && (
        <Modal title={`Editando: ${editing.nome}`} onClose={closeEdit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { label: "Nome", key: "nome" },
              { label: "Email", key: "email" },
              { label: "UF Atuação", key: "uf_atuacao" },
              { label: "Atuação Profissional", key: "atuacao_profissional" },
              { label: "Link Lattes", key: "link_lattes" },
            ].map(f => (
              <div key={f.key}>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{f.label}</label>
                <input className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  value={editForm[f.key] || ""} onChange={e => setEditForm({ ...editForm, [f.key]: e.target.value })} />
              </div>
            ))}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Status</label>
              <select className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]"
                value={editForm.status_registro || ""} onChange={e => setEditForm({ ...editForm, status_registro: e.target.value })}>
                {["ATIVO", "INCOMPLETO", "REVISAR", "DUPLICADO"].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="md:col-span-2 grid grid-cols-4 gap-3">
              {[["ibdp","IBDP"],["abep","ABEP"],["leciona","Leciona"],["mestre","Mestre"],["doutora","Doutora"],["especialista","Especialista"],["livre_docente","Livre Docente"]].map(([k,l]) => (
                <label key={k} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input type="checkbox" checked={!!editForm[k]} onChange={e => setEditForm({ ...editForm, [k]: e.target.checked })} />
                  {l}
                </label>
              ))}
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={closeEdit} className="px-4 py-2 border border-[var(--border)] rounded-lg text-sm font-semibold hover:bg-[var(--row-hover)]">Cancelar</button>
            <button onClick={saveEdit} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[var(--accent-hover)]"><Save className="w-4 h-4" /> Salvar</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ── Tab: Produções ────────────────────────────────────────────────────────────

const ProducoesTab = () => {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState<any>({ tipo_obra: "Artigo", area_processo: "P. Civil", formato: "ELETRONICA", acesso_eletronica: "PUBLICA" });
  const [associadasList, setAssociadasList] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("producoes_bibliograficas")
      .select("id,associada_id,citacao_completa,tipo_obra,ano_publicacao,area_processo,associadas(nome)", { count: "exact" })
      .order("ano_publicacao", { ascending: false });
    if (search) q = q.ilike("citacao_completa", `%${search}%`);
    const from = (page - 1) * LIMIT;
    q = q.range(from, from + LIMIT - 1);
    const { data: rows, count } = await q;
    setData(rows || []);
    setTotal(count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, search]);
  useEffect(() => {
    supabase.from("associadas").select("id, nome").is("deletado_em", null).order("nome").limit(500)
      .then(({ data }) => setAssociadasList(data || []));
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta produção?")) return;
    if (await gravou(supabase.from("producoes_bibliograficas").delete().eq("id", id), "excluir a produção")) load();
  };

  const saveEdit = async () => {
    const { id, associadas: _, ...payload } = editForm;
    if (payload.ano_publicacao) payload.ano_publicacao = Number(payload.ano_publicacao);
    if (!(await gravou(supabase.from("producoes_bibliograficas").update(payload).eq("id", id), "salvar a edição"))) return;
    setEditing(null);
    load();
  };

  const saveNew = async () => {
    if (!newForm.associada_id || !newForm.citacao_completa || !newForm.ano_publicacao) {
      alert("Preencha autora, citação e ano."); return;
    }
    const payload = { ...newForm, ano_publicacao: Number(newForm.ano_publicacao) };
    if (!(await gravou(supabase.from("producoes_bibliograficas").insert(payload), "criar a produção"))) return;
    setShowNew(false);
    setNewForm({ tipo_obra: "Artigo", area_processo: "P. Civil", formato: "ELETRONICA", acesso_eletronica: "PUBLICA" });
    load();
  };

  const totalPages = Math.ceil(total / LIMIT);
  // os valores de tipo_obra_enum e area_processo_enum; dissertações e teses
  // ficam de fora porque são recriadas a partir da titulação
  const tiposObra = ["Artigo", "Livro", "Capitulo de Livro", "Anais de Eventos", "Coluna em Jornais e Sites", "Org. ou Coord."];
  const areasProcesso = ["P. Civil", "P. Penal", "P. Trabalhista", "P. Tributario", "P. Constitucional", "P. Administrativo", "Outros"];

  const ProducaoFields = ({ form, setForm }: { form: any; setForm: any }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {!form.id && (
        <div className="md:col-span-2">
          <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Autora *</label>
          <select className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none"
            value={form.associada_id || ""} onChange={e => setForm({ ...form, associada_id: e.target.value })}>
            <option value="">Selecione...</option>
            {associadasList.map((a: any) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        </div>
      )}
      <div className="md:col-span-2">
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Citação Completa</label>
        <textarea rows={3} className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none"
          value={form.citacao_completa || ""} onChange={e => setForm({ ...form, citacao_completa: e.target.value })} />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Tipo de Obra</label>
        <select className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none"
          value={form.tipo_obra || ""} onChange={e => setForm({ ...form, tipo_obra: e.target.value })}>
          {tiposObra.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Área do Processo</label>
        <select className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none"
          value={form.area_processo || ""} onChange={e => setForm({ ...form, area_processo: e.target.value })}>
          {areasProcesso.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Ano de Publicação</label>
        <input type="number" className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none"
          value={form.ano_publicacao || ""} onChange={e => setForm({ ...form, ano_publicacao: e.target.value })} />
      </div>
      <div>
        <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Formato</label>
        <select className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm outline-none"
          value={form.formato || "ELETRONICA"} onChange={e => setForm({ ...form, formato: e.target.value })}>
          <option value="ELETRONICA">Eletrônica</option>
          <option value="FISICA">Física</option>
        </select>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-muted)]" />
          <input placeholder="Buscar na citação..." className="pl-10 pr-4 py-2 w-full border border-[var(--border)] rounded-lg text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center px-4 py-2 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition">
          <Plus className="w-4 h-4 mr-1" /> Nova Produção
        </button>
        <span className="text-xs text-[var(--text-muted)]">{total} registros</span>
      </div>

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Autora</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Citação</th>
                <th className="px-4 py-3">Ano</th>
                <th className="px-4 py-3">Área</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? <tr><td colSpan={6} className="text-center py-10 text-[var(--text-muted)]">Carregando...</td></tr>
                : data.map(row => (
                  <tr key={row.id} className="hover:bg-[var(--row-hover)]">
                    <td className="px-4 py-3 font-semibold max-w-[140px] truncate">{(row.associadas as any)?.nome || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{row.tipo_obra}</td>
                    <td className="px-4 py-3 max-w-[300px] truncate text-[var(--text-muted)]">{row.citacao_completa}</td>
                    <td className="px-4 py-3">{row.ano_publicacao}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{row.area_processo}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button onClick={() => { setEditing(row); setEditForm({ ...row }); }} className="p-1 text-[var(--text-muted)] hover:text-[var(--accent)]"><Edit className="w-4 h-4" /></button>
                      <SoAdmin><button onClick={() => handleDelete(row.id)} className="p-1 text-[var(--text-muted)] hover:text-[var(--error)]"><Trash2 className="w-4 h-4" /></button></SoAdmin>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-[var(--border)] flex justify-between items-center text-xs text-[var(--text-muted)]">
          <span>Página {page} de {Math.ceil(total / LIMIT) || 1}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Anterior</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Próximo</button>
          </div>
        </div>
      </div>

      {editing && (
        <Modal title="Editar Produção" onClose={() => setEditing(null)}>
          <ProducaoFields form={editForm} setForm={setEditForm} />
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={() => setEditing(null)} className="px-4 py-2 border border-[var(--border)] rounded-lg text-sm font-semibold hover:bg-[var(--row-hover)]">Cancelar</button>
            <button onClick={saveEdit} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[var(--accent-hover)]"><Save className="w-4 h-4" /> Salvar</button>
          </div>
        </Modal>
      )}
      {showNew && (
        <Modal title="Nova Produção Bibliográfica" onClose={() => setShowNew(false)}>
          <ProducaoFields form={newForm} setForm={setNewForm} />
          <div className="mt-6 flex justify-end gap-3">
            <button onClick={() => setShowNew(false)} className="px-4 py-2 border border-[var(--border)] rounded-lg text-sm font-semibold hover:bg-[var(--row-hover)]">Cancelar</button>
            <button onClick={saveNew} className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-[var(--accent-hover)]"><Plus className="w-4 h-4" /> Criar</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ── Tab: Vínculos Docentes ────────────────────────────────────────────────────

const VinculosTab = () => {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("vinculos_docentes")
      .select("id,tipo,instituicao,integra_ranking_40,associada_id,associadas(nome)", { count: "exact" })
      .order("instituicao");
    if (search) q = q.ilike("instituicao", `%${search}%`);
    const from = (page - 1) * LIMIT;
    q = q.range(from, from + LIMIT - 1);
    const { data: rows, count } = await q;
    setData(rows || []);
    setTotal(count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, search]);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este vínculo?")) return;
    if (await gravou(supabase.from("vinculos_docentes").delete().eq("id", id), "excluir o vínculo")) load();
  };

  const toggleRanking = async (row: any) => {
    if (await gravou(supabase.from("vinculos_docentes").update({ integra_ranking_40: !row.integra_ranking_40 }).eq("id", row.id), "alterar o Ranking 40+")) load();
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-[var(--text-muted)]" />
          <input placeholder="Buscar por instituição..." className="pl-10 pr-4 py-2 w-full border border-[var(--border)] rounded-lg text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]"
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <span className="text-xs text-[var(--text-muted)]">{total} vínculos</span>
      </div>

      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left whitespace-nowrap">
            <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Processualista</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Instituição</th>
                <th className="px-4 py-3">Ranking 40+</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? <tr><td colSpan={5} className="text-center py-10 text-[var(--text-muted)]">Carregando...</td></tr>
                : data.map(row => (
                  <tr key={row.id} className="hover:bg-[var(--row-hover)]">
                    <td className="px-4 py-3 font-semibold max-w-[200px] truncate">{(row.associadas as any)?.nome || "—"}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${row.tipo === "GRADUACAO" ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"}`}>{row.tipo}</span>
                    </td>
                    <td className="px-4 py-3 max-w-[220px] truncate">{row.instituicao}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleRanking(row)} className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${row.integra_ranking_40 ? "bg-[var(--success-bg)] text-[var(--success)] border-transparent" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                        {row.integra_ranking_40 ? "SIM" : "NÃO"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SoAdmin><button onClick={() => handleDelete(row.id)} className="p-1 text-[var(--text-muted)] hover:text-[var(--error)]"><Trash2 className="w-4 h-4" /></button></SoAdmin>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="p-3 border-t border-[var(--border)] flex justify-between items-center text-xs text-[var(--text-muted)]">
          <span>Página {page} de {totalPages || 1}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Anterior</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Próximo</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Tab: Notas ────────────────────────────────────────────────────────────────

const NotasTab = () => {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const from = (page - 1) * LIMIT;
    const { data: rows, count } = await supabase.from("notas")
      .select("id,texto,criado_em,associada_id,associadas(nome),perfis(nome)", { count: "exact" })
      .order("criado_em", { ascending: false })
      .range(from, from + LIMIT - 1);
    setData(rows || []);
    setTotal(count || 0);
    setLoading(false);
  };

  useEffect(() => { load(); }, [page]);

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir esta nota?")) return;
    if (await gravou(supabase.from("notas").delete().eq("id", id), "excluir a nota")) load();
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="space-y-4">
      <span className="text-xs text-[var(--text-muted)]">{total} notas no total</span>
      <div className="bg-white rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="divide-y divide-[var(--border)]">
          {loading ? <div className="text-center py-10 text-[var(--text-muted)] text-sm">Carregando...</div>
            : data.map(row => (
              <div key={row.id} className="p-4 flex justify-between items-start hover:bg-[var(--row-hover)]">
                <div className="flex-1 mr-4">
                  <div className="flex gap-3 items-center mb-1">
                    <span className="text-xs font-bold text-[var(--accent)]">{(row.associadas as any)?.nome || "—"}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">por {(row.perfis as any)?.nome || "Sistema"}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">{new Date(row.criado_em).toLocaleString("pt-BR")}</span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] whitespace-pre-wrap">{row.texto}</p>
                </div>
                <SoAdmin><button onClick={() => handleDelete(row.id)} className="p-1 text-[var(--text-muted)] hover:text-[var(--error)] flex-shrink-0"><Trash2 className="w-4 h-4" /></button></SoAdmin>
              </div>
            ))}
        </div>
        <div className="p-3 border-t border-[var(--border)] flex justify-between items-center text-xs text-[var(--text-muted)]">
          <span>Página {page} de {totalPages || 1}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Anterior</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 border border-[var(--border)] rounded disabled:opacity-40">Próximo</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Export All ────────────────────────────────────────────────────────────────

/** baixa tudo o que alimenta o site público, numa planilha de três abas */
const tudoDe = async (tabela: string, filtrar?: (q: any) => any) => {
  const linhas: any[] = [];
  for (let pg = 0; ; pg++) {
    let q = supabase.from(tabela).select("*").range(pg * 1000, pg * 1000 + 999);
    if (filtrar) q = filtrar(q);
    const { data } = await q;
    if (!data || data.length === 0) break;
    linhas.push(...data);
    if (data.length < 1000) break;
  }
  return linhas;
};

const exportAll = async () => {
  try {
    const [assoc, vinc, prod] = await Promise.all([
      tudoDe("associadas", (q) => q.is("deletado_em", null)),
      tudoDe("vinculos_docentes"),
      tudoDe("producoes_bibliograficas"),
    ]);

    await baixarXlsx(`base_completa_${new Date().toISOString().slice(0, 10)}.xlsx`, [
      { nome: "Associadas", ...deRegistros(assoc) },
      { nome: "Vinculos_Docentes", ...deRegistros(vinc) },
      { nome: "Producoes_Bibliograficas", ...deRegistros(prod) },
    ]);
  } catch {
    alert("Erro ao exportar base completa");
  }
};

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "associadas", label: "Associadas" },
  { id: "producoes", label: "Produções Bibliográficas" },
  { id: "vinculos", label: "Vínculos Docentes" },
  { id: "notas", label: "Notas" },
];

/**
 * Busca e correção registro a registro, em todas as tabelas da base.
 *
 * É uma das abas de Dados, e não mais uma página própria: qualquer pessoa
 * logada consulta e corrige, mas excluir continua sendo só de ADMIN — é o
 * que <SoAdmin> guarda, mais acima.
 */
export const AdminCrud = () => {
  const [activeTab, setActiveTab] = useState("associadas");
  const [exporting, setExporting] = useState(false);

  const handleExportAll = async () => {
    setExporting(true);
    await exportAll();
    setExporting(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <button
          onClick={handleExportAll}
          disabled={exporting}
          className="flex items-center px-4 py-2 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition shadow-sm disabled:opacity-60"
        >
          {exporting ? "Exportando..." : "⬇ Exportar Base Completa"}
        </button>
      </div>

      <div className="flex border-b border-[var(--border)] overflow-x-auto whitespace-nowrap">
        {TABS.map(tab => (
          <button key={tab.id}
            className={`px-5 py-3 font-semibold text-sm transition-colors ${activeTab === tab.id ? "border-b-2 border-[var(--accent)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "associadas" && <AssociadasTab />}
      {activeTab === "producoes" && <ProducoesTab />}
      {activeTab === "vinculos" && <VinculosTab />}
      {activeTab === "notas" && <NotasTab />}
    </div>
  );
};
