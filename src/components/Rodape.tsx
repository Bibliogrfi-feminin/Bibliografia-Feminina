/**
 * Rodape unico do site.
 *
 * Fica no Layout (que envolve todas as rotas internas) e tambem na tela de
 * login, que corre fora do Layout — sem isso ela ficaria sem creditos.
 *
 * O ano sai de new Date(): escrito na mao, envelheceria na virada do ano.
 */
export const Rodape = ({ compacto = false }: { compacto?: boolean }) => {
  const ano = new Date().getFullYear();

  if (compacto) {
    return (
      <footer className="text-center px-4">
        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
          Sistema completo de gestão e site desenvolvidos por{" "}
          <span className="font-semibold text-[var(--accent)]">Igor M. Rocha e Leonardo Horodenko Ferreira</span>, {ano}.
        </p>
        <p className="text-[11px] text-[var(--text-muted)] mt-1">
          Todos os direitos reservados.
        </p>
      </footer>
    );
  }

  return (
    <footer className="border-t border-[var(--border)] bg-white mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-9">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 text-center md:text-left">
          <div>
            <p className="font-serif font-semibold text-[14px] text-[var(--accent)]">
              Bibliografia Processual Feminina
            </p>
            <p className="text-[12.5px] text-[var(--text-muted)] mt-1 leading-relaxed">
              Grupo de pesquisa · Faculdade de Direito da Universidade de São Paulo
            </p>
          </div>

          <div className="md:text-right">
            <p className="text-[12.5px] text-[var(--text-muted)] leading-relaxed">
              Sistema completo de gestão e site desenvolvidos por{" "}
              <span className="font-semibold text-[var(--accent)]">Igor M. Rocha e Leonardo Horodenko Ferreira</span>, {ano}.
            </p>
            <p className="text-[12px] text-[var(--text-muted)] mt-1">
              Todos os direitos reservados.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
};
