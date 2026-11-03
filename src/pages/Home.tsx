import { ArrowRight, BookOpen, LayoutDashboard, FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";
import { usePagina, useNumerosHome } from "../lib/conteudo";
import { Markdown } from "../lib/markdown";
import banner from "../assets/banner-bpf.jpg";

const Numero = ({ valor, rotulo }: { valor?: number; rotulo: string }) => (
  <div className="text-center px-4 py-7">
    <div className="text-[28px] md:text-[32px] font-serif font-bold text-[var(--heading)] tabular-nums leading-none">
      {valor === undefined ? "—" : valor.toLocaleString("pt-BR")}
    </div>
    <div className="text-[11px] uppercase font-semibold text-[var(--text-muted)] tracking-[0.12em] mt-2.5">
      {rotulo}
    </div>
  </div>
);

export const Home = () => {
  const { pagina } = usePagina("home");
  const n = useNumerosHome();

  return (
    <div className="max-w-6xl mx-auto space-y-16 pb-20 fade-in">
      {/*
        A abertura é o próprio banner do grupo, no lugar do título escrito:
        ele já traz o nome, o selo da USP e o brasão da Faculdade.

        A faixa vai de borda a borda da tela, mas a imagem não: ela tem
        1170px e esticada ficaria borrada. O que preenche as laterais é a
        cor da borda do banner — #258989 em todos os lados, a mesma da
        barra de navegação —, então faixa e imagem emendam sem costura.
        As margens em vw tiram a faixa dos contêineres de largura máxima;
        o overflow-x-clip do <main> segura a sobra da barra de rolagem.
      */}
      <section className="mx-[calc(50%-50vw)] bg-[var(--logo-teal)]">
        <img
          src={banner}
          alt="Bibliografia Processual Feminina — grupo de pesquisa da Faculdade de Direito da Universidade de São Paulo"
          width={1170}
          height={472}
          className="w-full max-w-[1170px] h-auto block mx-auto"
        />
      </section>

      <section className="text-center !mt-10">
        {/*
          Serif, negrito e no teal da marca, como o título que abria a
          página — mas em corpo pequeno: este texto é uma frase inteira, e
          no tamanho do título antigo tomava meia tela. Como o nome do
          projeto agora vem dentro da imagem, este é o h1 da página, para a
          estrutura de cabeçalhos continuar tendo um.
        */}
        {pagina?.subtitulo && (
          <h1 className="text-[21px] md:text-[24px] font-serif font-bold text-[var(--heading)] max-w-2xl mx-auto leading-snug mb-8">
            {pagina.subtitulo}
          </h1>
        )}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            to="/consulta"
            className="px-6 py-2.5 bg-[var(--accent)] text-white text-[15px] font-semibold rounded-md hover:bg-[var(--accent-hover)] transition-colors inline-flex items-center"
          >
            Acessar a base
            <ArrowRight className="w-4 h-4 ml-2" />
          </Link>
          <Link
            to="/sobre"
            className="px-6 py-2.5 bg-white text-[var(--accent)] text-[15px] font-semibold rounded-md border border-[var(--border)] hover:border-[var(--heading)] transition-colors inline-flex items-center"
          >
            Conhecer o projeto
          </Link>
        </div>
      </section>

      {/* numeros vivos: o que a base realmente tem hoje */}
      <section className="bg-white border border-[var(--border)] rounded-xl divide-y md:divide-y-0 md:divide-x divide-[var(--border)] grid grid-cols-2 md:grid-cols-5">
        <Numero valor={n?.processualistas} rotulo="Processualistas" />
        <Numero valor={n?.producoes} rotulo="Produções" />
        <Numero valor={n?.mestrados} rotulo="Mestrados" />
        <Numero valor={n?.doutorados} rotulo="Doutorados" />
        <Numero valor={n?.livre_docencias} rotulo="Livre-docências" />
      </section>

      {/* texto institucional, editavel pelo painel */}
      {pagina?.conteudo && (
        <section className="max-w-3xl mx-auto bg-white rounded-xl border border-[var(--border)] p-8 md:p-11">
          <Markdown texto={pagina.conteudo} />
        </section>
      )}

      {/* caminhos */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* na ordem do cabeçalho: a base, os números, e só então o projeto */}
        {[
          { to: "/consulta", Icone: BookOpen, titulo: "Consultar a base", texto: "Busque processualistas por nome, estado, titulação e área do processo, e chegue às obras publicadas." },
          { to: "/dashboards", Icone: LayoutDashboard, titulo: "Ver as estatísticas", texto: "Atuação, titulação e produção bibliográfica das processualistas, em gráficos que se filtram por estado e entidade." },
          { to: "/sobre", Icone: FlaskConical, titulo: "Conhecer o projeto", texto: "Por que o levantamento existe, as cinco etapas da metodologia e a equipe que conduziu a pesquisa." },
        ].map(({ to, Icone, titulo, texto }) => (
          <Link
            key={to}
            to={to}
            className="bg-white p-7 rounded-xl border border-[var(--border)] flex flex-col hover:border-[var(--heading)] transition-colors group"
          >
            <div className="w-10 h-10 bg-[var(--nav-active)] rounded-lg flex items-center justify-center mb-5">
              <Icone className="w-5 h-5 text-[var(--accent)]" />
            </div>
            <h3 className="font-serif font-semibold text-[17px] text-[var(--text-main)] mb-2">{titulo}</h3>
            <p className="text-[var(--text-muted)] text-[14px] leading-relaxed">{texto}</p>
            <span className="mt-4 text-[var(--accent)] text-[12px] font-semibold inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              Ver <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </Link>
        ))}
      </section>
    </div>
  );
};
