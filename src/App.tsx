/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ReactNode, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { observarAltura, anunciarRota, ouvirNavegacao, dentroDeIframe } from "./lib/embed";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { Consulta } from "./pages/Consulta";
import { Dashboards } from "./pages/Dashboards";
import { Administracao } from "./pages/Administracao";
import { Dados } from "./pages/Dados";
import { FichaAssociada } from "./pages/FichaAssociada";
import { Home } from "./pages/Home";
import { OProjeto } from "./pages/OProjeto";

function ProtectedRoute({ children, reqAdmin = false }: { children: ReactNode; reqAdmin?: boolean }) {
  const { user, loading } = useAuth();
  
  if (loading) return <div className="p-10 text-center">Carregando...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (reqAdmin && user.role !== "ADMIN") return <Navigate to="/" replace />;
  
  return children;
}

/**
 * Quando o site roda embutido na pagina do WordPress da USP, mantem o
 * iframe do tamanho do conteudo e espelha a rota no endereco do pai, para
 * que links diretos e o botao voltar continuem funcionando.
 */
function SincronizaEmbed() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!dentroDeIframe()) return;
    const pararAltura = observarAltura();
    const pararNavegacao = ouvirNavegacao((rota) => navigate(rota));
    return () => { pararAltura(); pararNavegacao(); };
  }, [navigate]);

  useEffect(() => {
    anunciarRota(location.pathname + location.search);
  }, [location.pathname, location.search]);

  return null;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="sobre" element={<OProjeto />} />
        {/* viraram seções de /sobre; os endereços antigos levam à seção certa */}
        <Route path="metodologia" element={<Navigate to="/sobre?secao=metodologia" replace />} />
        <Route path="quem-somos" element={<Navigate to="/sobre?secao=equipe" replace />} />
        {/* rota antiga, mantida para nao quebrar links ja divulgados */}
        <Route path="idealizadoras" element={<Navigate to="/sobre?secao=equipe" replace />} />
        <Route path="consulta" element={<Consulta />} />
        <Route path="consulta/:id" element={<FichaAssociada />} />
        <Route path="dashboards" element={<Dashboards />} />
        <Route path="dados" element={<ProtectedRoute><Dados /></ProtectedRoute>} />
        <Route path="admin" element={<ProtectedRoute reqAdmin><Administracao /></ProtectedRoute>} />
        {/* endereços antigos das telas que viraram abas de /dados */}
        <Route path="alimentacao" element={<Navigate to="/dados" replace />} />
        <Route path="admin/dados" element={<Navigate to="/dados" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SincronizaEmbed />
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

