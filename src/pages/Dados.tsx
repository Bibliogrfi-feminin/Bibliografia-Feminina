import { useState } from "react";
import { useAuth } from "../lib/AuthContext";
import { FilePlus2, UploadCloud, Table2, ScanSearch } from "lucide-react";
import { CadastroIndividual } from "./Alimentacao";
import { AlimentacaoEmLote } from "../components/AlimentacaoEmLote";
import { AdminCrud } from "./AdminCrud";
import { ColetaLattes } from "../components/ColetaLattes";

/**
 * Tudo que alimenta e edita a base, em um lugar só.
 *
 * As três maneiras de mexer nos dados ficam lado a lado porque são a
 * mesma tarefa em escalas diferentes: uma pessoa por vez, uma planilha
 * inteira, ou caçar e corrigir um registro específico. Antes elas
 * estavam espalhadas entre "Alimentação", "Administração" e "Dados", e
 * não havia como saber, de fora, qual delas usar.
 *
 * A alimentação em lote é só para ADMIN: é a única que mexe em milhares
 * de registros de uma vez. A coleta Lattes é da equipe toda e não toca a
 * base: trabalha num lote à parte e devolve uma planilha.
 */

type Aba = "individual" | "lote" | "coleta" | "registros";

export const Dados = () => {
  const { user } = useAuth();
  const ehAdmin = user?.role === "ADMIN";
  const [aba, setAba] = useState<Aba>("individual");

  const abas: { id: Aba; label: string; icone: typeof FilePlus2; descricao: string }[] = [
    { id: "individual", label: "Cadastro individual", icone: FilePlus2,
      descricao: "Uma processualista ou uma obra por vez." },
    ...(ehAdmin ? [{ id: "lote" as Aba, label: "Alimentação em lote", icone: UploadCloud,
      descricao: "Enviar uma planilha e atualizar a base de uma vez." }] : []),
    { id: "coleta", label: "Coleta Lattes", icone: ScanSearch,
      descricao: "Preencher a planilha de mapeamento a partir do currículo Lattes de cada pessoa." },
    { id: "registros", label: "Registros", icone: Table2,
      descricao: "Procurar e corrigir registro por registro." },
  ];

  const atual = abas.find((a) => a.id === aba) ?? abas[0];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div>
        <h2 className="text-xl font-serif italic text-[var(--text-main)]">Dados</h2>
        <p className="text-sm text-[var(--text-muted)]">{atual.descricao}</p>
      </div>

      <div className="flex border-b border-[var(--border)] overflow-x-auto whitespace-nowrap">
        {abas.map(({ id, label, icone: Icone }) => (
          <button
            key={id}
            onClick={() => setAba(id)}
            className={`flex items-center gap-2 px-5 py-3 font-semibold text-sm transition-colors ${
              aba === id
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-main)]"
            }`}
          >
            <Icone className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {aba === "individual" && <CadastroIndividual />}
      {aba === "lote" && ehAdmin && <AlimentacaoEmLote />}
      {aba === "coleta" && <ColetaLattes />}
      {aba === "registros" && <AdminCrud />}
    </div>
  );
};
