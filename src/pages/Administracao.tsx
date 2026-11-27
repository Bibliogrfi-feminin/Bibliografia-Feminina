import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { callEdgeFunction } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { UserPlus, Clock, X } from "lucide-react";
import { EditorConteudo } from "../components/EditorConteudo";

/**
 * Administração cuida de quem entra e do que o visitante lê — acesso,
 * textos das páginas e a trilha do que foi feito na base.
 *
 * Mexer nos dados em si é a aba Dados. A importação de planilha, que
 * morava aqui como "Substituir Base", virou "Alimentação em lote" lá:
 * é alimentação, não administração, e o nome antigo prometia uma
 * substituição integral que deixou de ser o comportamento padrão.
 */
const TABS = {
  usuarios: "Usuários",
  conteudo: "Textos do Site",
  auditoria: "Histórico de Alimentação",
} as const;

export const Administracao = () => {
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("usuarios");
  const { user } = useAuth();

  const [showModal, setShowModal] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [isEditing, setIsEditing] = useState<any>(null);
  const [formData, setFormData] = useState({ nome: "", email: "", senha: "", role: "ANOTADOR" });

  const loadData = async () => {
    try {
      const [usersRes, auditRes] = await Promise.all([
        callEdgeFunction("admin-users", "GET"),
        supabase.from("audit_logs").select("*, perfis(nome)").order("criado_em", { ascending: false }).limit(100),
      ]);
      setUsers(usersRes || []);
      setAuditLogs(auditRes.data || []);
    } catch {
      alert("Erro ao carregar dados administrativos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Esc fecha o modal — é o reflexo de quem usa teclado, e sem isso a
  // única saída é acertar o botão
  useEffect(() => {
    if (!showModal) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !salvando) setShowModal(false);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [showModal, salvando]);

  if (user?.role !== "ADMIN") return null;

  const handleDelete = async (id: string) => {
    if (id === user.id) return alert("Não pode excluir a si próprio.");
    if (confirm("Confirmar exclusão de usuário?")) {
      await callEdgeFunction("admin-users", "DELETE", undefined, id);
      loadData();
    }
  };

  const openNew = () => {
    setIsEditing(null);
    setFormData({ nome: "", email: "", senha: "", role: "ANOTADOR" });
    setShowModal(true);
  };

  const openEdit = (u: any) => {
    setIsEditing(u);
    setFormData({ nome: u.nome, email: u.email, senha: "", role: u.role });
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      if (isEditing) {
        // senha em branco na edição significa "não mexer na senha"
        const { senha, ...resto } = formData;
        await callEdgeFunction("admin-users", "PUT", senha ? formData : resto, isEditing.id);
      } else {
        await callEdgeFunction("admin-users", "POST", formData);
      }
      setShowModal(false);
      loadData();
    } catch (err: any) {
      alert(err.message || "Erro ao salvar usuário. Email pode já estar em uso.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-serif italic text-[var(--text-main)]">Administração do Sistema</h2>
          <p className="text-sm text-[var(--text-muted)]">Gerenciamento de acessos e histórico de auditoria.</p>
        </div>
        {activeTab === "usuarios" && (
          <button onClick={openNew} className="flex items-center px-4 py-2 bg-[var(--accent)] text-white text-sm font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition shadow-sm">
            <UserPlus className="w-4 h-4 mr-2" />
            Novo Usuário
          </button>
        )}
      </div>

      <div className="flex border-b border-[var(--border)] overflow-x-auto whitespace-nowrap">
        {Object.entries(TABS).map(([tab, label]) => (
          <button
            key={tab}
            className={`px-4 py-3 font-semibold text-sm ${activeTab === tab ? "border-b-2 border-[var(--accent)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "conteudo" && <EditorConteudo />}

      {activeTab === "usuarios" && (
        <div className="bg-white rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-[var(--text-muted)]">Carregando...</div>
          ) : (
            <table className="w-full text-left text-xs whitespace-nowrap">
              <thead className="bg-white px-4 text-[11px] uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--border)]">
                <tr>
                  <th className="px-6 py-3 font-semibold">Nome</th>
                  <th className="px-6 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Permissão</th>
                  <th className="px-6 py-3 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {users.map((u: any) => (
                  <tr key={u.id} className="hover:bg-[var(--row-hover)]">
                    <td className="px-6 py-4 font-bold text-[var(--text-main)]">{u.nome}</td>
                    <td className="px-6 py-4 text-[var(--text-muted)]">{u.email}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex px-2 py-0.5 text-[10px] uppercase tracking-wider font-bold rounded ${u.role === "ADMIN" ? "bg-[#5e5e45] text-white" : "bg-white border border-[var(--border)] text-[var(--text-muted)]"}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right space-x-3">
                      <button onClick={() => openEdit(u)} className="text-[var(--accent)] hover:text-black font-semibold">Editar</button>
                      {u.id !== user.id && <button onClick={() => handleDelete(u.id)} className="text-[var(--error)] hover:text-red-800 font-semibold">Excluir</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "auditoria" && (
        <div className="bg-white rounded-xl border border-[var(--border)] shadow-sm overflow-hidden p-6 space-y-4">
          {loading ? (
            <div className="p-10 text-center text-[var(--text-muted)]">Carregando auditoria...</div>
          ) : auditLogs.length === 0 ? (
            <div className="p-10 text-center text-[var(--text-muted)]">Nenhum registro encontrado.</div>
          ) : (
            <div className="space-y-4">
              {auditLogs.map((log: any) => (
                <div key={log.id} className="flex items-start bg-[var(--row-hover)] p-4 rounded-lg border border-[var(--border)]">
                  <div className="mr-4 mt-1 text-[var(--text-muted)]"><Clock className="w-5 h-5" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[var(--text-main)]">
                      {log.perfis?.nome || "Sistema"} <span className="font-normal text-[var(--text-muted)]">realizou ação de</span>{" "}
                      <span className="uppercase text-[var(--accent)] font-bold text-xs">{log.acao}</span>
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Entidade: {log.entidade} (ID: {log.entidade_id || "N/A"})
                    </p>
                    {log.detalhes && (
                      <pre className="mt-2 bg-white p-2 rounded border border-[var(--border)] text-[10px] overflow-auto max-w-full text-[var(--text-muted)]">
                        {JSON.stringify(log.detalhes, null, 2)}
                      </pre>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] whitespace-nowrap pl-4">
                    {new Date(log.criado_em).toLocaleString("pt-BR")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/*
        Este formulário sumiu por engano num refactor de 26/08: a área
        privada estava sendo podada do que gravava sem chegar ao site
        público, e o modal foi junto — embora gestão de acesso nada tenha
        a ver com isso. `showModal`, `openNew` e `handleSave` ficaram no
        arquivo sem nada que os renderizasse, então "Novo Usuário" não
        abria nada e não dava erro.
      */}
      {showModal && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !salvando && setShowModal(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden border border-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center bg-[var(--nav-hover)]">
              <h3 className="font-bold text-[var(--text-main)]">
                {isEditing ? "Editar Usuário" : "Novo Usuário"}
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                  Nome completo
                </label>
                <input
                  required autoFocus value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                  E-mail
                </label>
                <input
                  required type="email" value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg outline-none focus:ring-1 focus:ring-[var(--accent)]"
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                  {isEditing ? "Nova senha" : "Senha inicial"}
                </label>
                {/*
                  à mostra de propósito: quem cria precisa copiar a senha
                  para passar à pessoa, e conferir o que digitou
                */}
                <input
                  required={!isEditing} type="text" value={formData.senha}
                  onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
                  placeholder={isEditing ? "deixe em branco para não alterar" : ""}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg outline-none focus:ring-1 focus:ring-[var(--accent)] font-mono text-sm"
                />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">
                  No primeiro acesso com esta senha, a pessoa é obrigada a trocá-la por uma só dela.
                </p>
              </div>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">
                  Nível de permissão
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg outline-none focus:ring-1 focus:ring-[var(--accent)]"
                >
                  <option value="PESQUISADOR">Pesquisador(a)</option>
                  <option value="ANOTADOR">Anotadora</option>
                  <option value="ADMIN">Administradora</option>
                </select>
                <p className="text-[11px] text-[var(--text-muted)] mt-2 leading-relaxed">
                  <strong>Pesquisador(a)</strong> cadastra pessoas novas e coleta currículos; a revisão
                  vai para a conferência da equipe e não pode apagar nem esvaziar o que já existe. A{" "}
                  <strong>anotadora</strong> cadastra, corrige registros e confere as revisões. A{" "}
                  <strong>administradora</strong> faz isso e mais: gerencia usuários, edita os
                  textos do site, alimenta a base por planilha e exclui registros.
                </p>
              </div>

              <div className="pt-4 flex space-x-3 justify-end">
                <button
                  type="button" disabled={salvando}
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 font-semibold text-[var(--text-main)] bg-white border border-[var(--border)] hover:bg-[var(--row-hover)] rounded-lg transition disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit" disabled={salvando}
                  className="px-4 py-2 bg-[var(--accent)] text-white font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition shadow-sm disabled:opacity-60"
                >
                  {salvando ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
