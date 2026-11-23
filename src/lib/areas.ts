/**
 * Área em que a pessoa defendeu mestrado, doutorado ou livre-docência —
 * a lista fechada da planilha base. O Lattes não traz essa classificação:
 * quem escolhe é sempre o grupo.
 */
export const AREAS_TITULACAO = [
  "Direito Civil",
  "Direito Comercial",
  "Direito Tributário e Econômico",
  "Direito Ambiental",
  "Direito Constitucional e Estado",
  "Direito Internacional",
  "Direito do Trabalho",
  "Direito Penal",
  "Filosofia e TGD",
  "Direito Processual - Civil",
  "Direito Processual - Penal",
  "Direito Processual - Trabalho",
  "Direito Processual - Tributário",
  "Direito Processual - Constitucional",
  "Direito Processual - Administrativo",
] as const;

/** A lista, mais o valor atual se ele estiver fora dela (para não sumir). */
export function opcoesDeArea(atual?: string | null): string[] {
  const v = (atual ?? "").trim();
  return v && !(AREAS_TITULACAO as readonly string[]).includes(v) ? [v, ...AREAS_TITULACAO] : [...AREAS_TITULACAO];
}
