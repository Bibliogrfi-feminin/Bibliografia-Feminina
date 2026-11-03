-- =====================================================================
-- Dados fictícios para o Ambiente de Teste (xiswismliggsmzltsavb).
--
-- Nenhuma pessoa aqui existe: nomes, obras e e-mails (domínio .test,
-- reservado) são inventados. Serve para explorar a área da equipe e
-- reproduzir bugs sem tocar na base real.
--
-- Rodar no SQL Editor do Ambiente de Teste. É idempotente: ids fixos e
-- ON CONFLICT, então rodar de novo não duplica nada.
-- =====================================================================

do $$
begin
  -- trava: a produção tem centenas de associadas; o teste, quase nada
  if (select count(*) from public.associadas) > 50 then
    raise exception 'Mais de 50 associadas: isto parece a produção. Seed abortado.';
  end if;
end $$;

-- -------------------------------------------------------- associadas
insert into public.associadas (
  id, nome, email, status_registro, leciona, atuacao_profissional, uf_atuacao,
  ibdp, abep, link_lattes, data_atualizacao_lattes, especialista,
  mestre, titulo_mestrado, ano_mestrado, faculdade_mestrado, area_mestrado,
  doutora, titulo_doutorado, ano_doutorado, faculdade_doutorado, area_doutorado,
  livre_docente, titulo_livre_docencia, ano_livre_docencia, faculdade_livre_docencia, area_livre_docencia
) values
  ('00000000-0000-4000-a000-000000000001', 'Ana Exemplo da Silva', 'ana.exemplo@exemplo.test', 'ATIVO',
   true, 'Docência (Exclusivamente)', 'SP', true, false, null, '2026-03-01', true,
   true, 'Tutela provisória em tempos de teste', '2012', 'Universidade Fictícia de São Paulo', 'Direito Processual - Civil',
   true, 'Precedentes imaginários e segurança jurídica', '2017', 'Universidade Fictícia de São Paulo', 'Direito Processual - Civil',
   true, 'Uma teoria geral do processo de demonstração', '2024', 'Universidade Fictícia de São Paulo', 'Direito Processual - Civil'),
  ('00000000-0000-4000-a000-000000000002', 'Beatriz Ficticia Ramos', 'beatriz.ficticia@exemplo.test', 'ATIVO',
   true, 'Advocacia Privada', 'RJ', true, true, null, '2025-11-10', true,
   true, 'Prova digital no processo penal simulado', '2015', 'Faculdade Modelo do Rio', 'Direito Processual - Penal',
   true, 'Cadeia de custódia de evidências inventadas', '2021', 'Faculdade Modelo do Rio', 'Direito Processual - Penal',
   false, null, null, null, null),
  ('00000000-0000-4000-a000-000000000003', 'Carla Teste Moreira', null, 'ATIVO',
   false, 'Poder Judiciário', 'MG', false, true, null, null, true,
   true, 'Execução trabalhista de mentirinha', '2019', 'Universidade Exemplar de Minas', 'Direito Processual - Trabalhista',
   false, null, null, null, null,
   false, null, null, null, null),
  ('00000000-0000-4000-a000-000000000004', 'Daniela Amostra Costa', 'daniela.amostra@exemplo.test', 'INCOMPLETO',
   false, 'Advocacia Pública', 'PR', true, false, null, null, false,
   false, null, null, null, null,
   false, null, null, null, null,
   false, null, null, null, null),
  ('00000000-0000-4000-a000-000000000005', 'Elisa Prototipo Lima', 'elisa.prototipo@exemplo.test', 'REVISAR',
   true, 'Mediação / Conciliação', 'RS', false, false, null, '2024-06-20', true,
   true, 'Mediação em conflitos hipotéticos', '2010', 'Centro Universitário Exemplo', 'Direito Processual - Civil',
   true, 'Acesso à justiça no laboratório', '2016', 'Centro Universitário Exemplo', 'Direito Processual - Civil',
   false, null, null, null, null),
  ('00000000-0000-4000-a000-000000000006', 'Fernanda Simulada Rocha', 'fernanda.simulada@exemplo.test', 'ATIVO',
   false, 'Outros Setores', 'DF', true, true, null, null, true,
   false, null, null, null, null,
   false, null, null, null, null,
   false, null, null, null, null)
on conflict (id) do nothing;

-- ------------------------------------------------ vínculos docentes
insert into public.vinculos_docentes (id, associada_id, tipo, instituicao, integra_ranking_40) values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'POS',       'Universidade Fictícia de São Paulo', true),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000001', 'GRADUACAO', 'Universidade Fictícia de São Paulo', true),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000002', 'GRADUACAO', 'Faculdade Modelo do Rio', false),
  ('00000000-0000-4000-b000-000000000004', '00000000-0000-4000-a000-000000000005', 'POS',       'Centro Universitário Exemplo', true)
on conflict (id) do nothing;

-- ------------------------------------------- produção bibliográfica
insert into public.producoes_bibliograficas
  (id, associada_id, tipo_obra, citacao_completa, ano_publicacao, area_processo, formato, acesso_eletronica, link_acesso)
values
  ('00000000-0000-4000-c000-000000000001', '00000000-0000-4000-a000-000000000001', 'Livro',
   'SILVA, Ana Exemplo da. Manual de processo civil de demonstração. São Paulo: Editora Fictícia, 2020.', '2020', 'P. Civil', 'FISICA', null, null),
  ('00000000-0000-4000-c000-000000000002', '00000000-0000-4000-a000-000000000001', 'Artigo',
   'SILVA, Ana Exemplo da. Precedentes que não existem. Revista de Processo Imaginário, v. 1, p. 10-30, 2022.', '2022', 'P. Civil', 'ELETRONICA', 'PUBLICA', 'https://exemplo.test/artigo-1'),
  ('00000000-0000-4000-c000-000000000003', '00000000-0000-4000-a000-000000000001', 'Capitulo de Livro',
   'SILVA, Ana Exemplo da. Tutela de urgência. In: COSTA, D. (org.). Estudos de teste. Rio de Janeiro: Modelo, 2023. p. 45-70.', '2023', 'P. Civil', 'FISICA', null, null),
  ('00000000-0000-4000-c000-000000000004', '00000000-0000-4000-a000-000000000002', 'Artigo',
   'RAMOS, Beatriz Ficticia. Prova digital e garantias. Revista Penal de Exemplo, n. 7, p. 1-20, 2021.', '2021', 'P. Penal', 'ELETRONICA', 'PROTEGIDA', null),
  ('00000000-0000-4000-c000-000000000005', '00000000-0000-4000-a000-000000000002', 'Coluna em Jornais e Sites',
   'RAMOS, Beatriz Ficticia. O júri do futuro. Jornal Fictício, 12 mar. 2024.', '2024', 'P. Penal', 'ELETRONICA', 'PUBLICA', 'https://exemplo.test/coluna'),
  ('00000000-0000-4000-c000-000000000006', '00000000-0000-4000-a000-000000000003', 'Anais de Eventos',
   'MOREIRA, Carla Teste. Execução trabalhista. In: CONGRESSO DE EXEMPLO, 3., 2019, Belo Horizonte. Anais... p. 100-110.', '2019', 'P. Trabalhista', 'FISICA', null, null),
  ('00000000-0000-4000-c000-000000000007', '00000000-0000-4000-a000-000000000004', 'Artigo',
   'COSTA, Daniela Amostra. Fazenda pública em juízo. Revista de Direito Público Teste, v. 2, 2025.', '2025', 'P. Administrativo', 'ELETRONICA', 'PUBLICA', null),
  ('00000000-0000-4000-c000-000000000008', '00000000-0000-4000-a000-000000000005', 'Livro',
   'LIMA, Elisa Prototipo. Mediação sem conflito. Porto Alegre: Editora Protótipo, 2018.', '2018', 'P. Civil', 'FISICA', null, null),
  ('00000000-0000-4000-c000-000000000009', '00000000-0000-4000-a000-000000000005', 'Org. ou Coord.',
   'LIMA, Elisa Prototipo (coord.). Acesso à justiça em debate. Porto Alegre: Protótipo, 2023.', '2023', 'P. Constitucional', 'FISICA', null, null),
  ('00000000-0000-4000-c000-000000000010', '00000000-0000-4000-a000-000000000006', 'Artigo',
   'ROCHA, Fernanda Simulada. Processo tributário de ensaio. Revista Fiscal Fictícia, n. 4, 2026.', '2026', 'P. Tributario', 'ELETRONICA', 'PUBLICA', null)
on conflict (id) do nothing;

-- dissertações e teses saem das colunas de titulação, como na produção
select public.sincronizar_obras_de_titulacao();

-- ------------------------------------------------ textos do site
insert into public.paginas (slug, titulo, subtitulo, conteudo, ordem) values
  ('home', 'Bibliografia Processual Feminina', 'AMBIENTE DE TESTE',
   E'## Ambiente de teste\n\nTodos os dados desta base são **fictícios**.', 0),
  ('sobre', 'O Projeto', 'Ambiente de teste', 'Texto de exemplo da página **Sobre**.', 1),
  ('metodologia', 'Metodologia', 'Ambiente de teste', 'Texto de exemplo da página **Metodologia**.', 2),
  ('quem-somos', 'Quem Somos', 'Ambiente de teste', 'Texto de exemplo da página **Quem Somos**.', 3)
on conflict (slug) do nothing;

insert into public.grupos_membros (nome, ordem) values ('Coordenação', 0), ('Integrantes', 1)
on conflict (nome) do nothing;

insert into public.membros (id, nome, funcao, grupo, ordem) values
  ('00000000-0000-4000-d000-000000000001', 'Pessoa Coordenadora Exemplo', 'Coordenação', 'Coordenação', 0),
  ('00000000-0000-4000-d000-000000000002', 'Pessoa Integrante Exemplo', 'Pesquisa', 'Integrantes', 0)
on conflict (id) do nothing;
