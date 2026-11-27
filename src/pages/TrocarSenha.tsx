import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/AuthContext";
import { Rodape } from "../components/Rodape";

/**
 * Primeiro acesso: a conta nasceu com a senha padrão (ou a administradora
 * redefiniu a senha). Enquanto a troca não acontece, o portal só mostra
 * esta tela, e o banco não deixa a pessoa gravar nada. Ao trocar, um
 * gatilho no banco tira a marca de "trocar_senha".
 */
export const TrocarSenha = () => {
  const { user, recarregarPerfil, logout } = useAuth();
  const navigate = useNavigate();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    if (senha.length < 8) return setErro("A senha precisa ter pelo menos 8 caracteres.");
    if (senha !== confirma) return setErro("As duas senhas não são iguais.");
    setOcupado(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) {
        throw new Error(/different|same/i.test(error.message)
          ? "A nova senha precisa ser diferente da senha inicial."
          : error.message);
      }
      await recarregarPerfil();
      navigate("/dados", { replace: true });
    } catch (e: any) {
      setErro(e.message);
      setOcupado(false);
    }
  };

  const classeCampo =
    "w-full px-4 py-2 bg-white border border-[var(--border)] rounded-lg focus:ring-1 focus:ring-[var(--accent)] outline-none transition-all";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--bg)] relative p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-sm border border-[var(--border)]">
        <div className="text-center space-y-2">
          <KeyRound className="w-8 h-8 mx-auto text-[var(--accent)]" />
          <h2 className="text-2xl font-serif italic text-[var(--accent)] tracking-tight">Defina sua senha</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {user?.nome ? `${user.nome}, este` : "Este"} é seu primeiro acesso (ou sua senha foi redefinida).
            Escolha uma senha só sua para continuar.
          </p>
        </div>

        <form onSubmit={enviar} className="space-y-4">
          {erro && <div className="p-3 text-sm text-[var(--error)] bg-white border border-[var(--error)] rounded-md">{erro}</div>}
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Nova senha</label>
            <input type="password" required autoComplete="new-password" className={classeCampo}
              value={senha} onChange={(e) => setSenha(e.target.value)} />
            <p className="text-[11px] text-[var(--text-muted)] mt-1">Pelo menos 8 caracteres, diferente da senha inicial.</p>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Repita a nova senha</label>
            <input type="password" required autoComplete="new-password" className={classeCampo}
              value={confirma} onChange={(e) => setConfirma(e.target.value)} />
          </div>
          <button type="submit" disabled={ocupado}
            className="w-full py-2.5 px-4 text-white font-semibold bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg shadow-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
            {ocupado && <Loader2 className="w-4 h-4 animate-spin" />} Salvar e entrar
          </button>
          <button type="button" onClick={async () => { await logout(); navigate("/login"); }}
            className="w-full text-xs text-[var(--text-muted)] hover:underline">
            Sair
          </button>
        </form>
      </div>

      <div className="absolute bottom-8 w-full">
        <Rodape compacto />
      </div>
    </div>
  );
};
