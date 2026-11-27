import { createContext, useContext, useState, useEffect } from "react";
import { supabase } from "./supabase";

/** trocarSenha: senha dada pela administradora, ainda não trocada */
type User = { id: string; nome: string; email: string; role: string; trocarSenha: boolean };

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** relê o perfil (depois de trocar a senha, a marca sai) */
  recarregarPerfil: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchPerfil = async (userId: string, email: string) => {
    const { data } = await supabase
      .from("perfis")
      .select("id, nome, role, trocar_senha")
      .eq("id", userId)
      .single();
    if (data) setUser({ id: data.id, nome: data.nome, email, role: data.role, trocarSenha: !!data.trocar_senha });
  };

  const recarregarPerfil = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) await fetchPerfil(session.user.id, session.user.email!);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        fetchPerfil(session.user.id, session.user.email!).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        fetchPerfil(session.user.id, session.user.email!);
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, recarregarPerfil }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
