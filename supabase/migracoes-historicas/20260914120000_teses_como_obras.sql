-- =====================================================================
-- Dissertações e teses como linhas de producoes_bibliograficas.
--
-- Enquanto a base pública era servida de arquivos estáticos, esses 581
-- trabalhos eram DERIVADOS da titulação no gerador. Voltando a consultar
-- o Supabase, eles precisam existir como obras de verdade — senão a busca
-- perde 581 trabalhos e o total cai de 7.404 para 6.823.
--
-- É idempotente: apaga as derivadas antes de recriar, então pode rodar de
-- novo depois de a planilha mudar.
-- =====================================================================

-- 1. tipos novos no enum (ALTER TYPE não roda dentro de transação com uso
--    imediato do valor, por isso vem antes de tudo, em statements próprios)
ALTER TYPE public.tipo_obra_enum ADD VALUE IF NOT EXISTS 'Dissertação de Mestrado';
ALTER TYPE public.tipo_obra_enum ADD VALUE IF NOT EXISTS 'Tese de Doutorado';
ALTER TYPE public.tipo_obra_enum ADD VALUE IF NOT EXISTS 'Tese de Livre-Docência';

-- 2. recria as obras derivadas da titulação
--    (idempotente: limpa as anteriores antes de inserir)
DELETE FROM public.producoes_bibliograficas
WHERE tipo_obra IN ('Dissertação de Mestrado', 'Tese de Doutorado', 'Tese de Livre-Docência');

-- mapeia a área escrita por extenso na titulação para o enum
CREATE OR REPLACE FUNCTION public.area_da_titulacao(p text)
RETURNS public.area_processo_enum
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN 'Outros'::public.area_processo_enum
    WHEN lower(p) LIKE '%civil%'         THEN 'P. Civil'
    WHEN lower(p) LIKE '%penal%'         THEN 'P. Penal'
    WHEN lower(p) LIKE '%trabalh%'       THEN 'P. Trabalhista'
    WHEN lower(p) LIKE '%tribut%'        THEN 'P. Tributario'
    WHEN lower(p) LIKE '%constitucion%'  THEN 'P. Constitucional'
    WHEN lower(p) LIKE '%administrat%'   THEN 'P. Administrativo'
    ELSE 'Outros'
  END::public.area_processo_enum
$$;

-- parte dos campos vem da planilha já com pontuação final; sem aparar, a
-- citação sai com "…, Brasil., 1973."
CREATE OR REPLACE FUNCTION public.sem_pontuacao_final(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(regexp_replace(btrim(coalesce(p, '')), '[.,;]+$', '')), '')
$$;

INSERT INTO public.producoes_bibliograficas
  (associada_id, tipo_obra, citacao_completa, ano_publicacao, area_processo, formato, link_acesso)
SELECT
  t.id,
  t.tipo::public.tipo_obra_enum,
  -- o nome fica como está na planilha: inverter para "SOBRENOME, Nome"
  -- erra em nome composto e sobrenome estrangeiro
  t.nome || '. ' || public.sem_pontuacao_final(t.titulo) || '. ' || t.mencao ||
    COALESCE(
      ' — ' || NULLIF(
        concat_ws(', ', public.sem_pontuacao_final(t.faculdade), NULLIF(t.ano, '')),
      ''),
    '') || '.',
  COALESCE(NULLIF(t.ano, ''), 's/d'),
  public.area_da_titulacao(t.area),
  'ELETRONICA'::public.formato_enum,
  t.link
FROM (
  SELECT id, nome, 'Dissertação de Mestrado' AS tipo, 'Dissertação (Mestrado)' AS mencao,
         titulo_mestrado AS titulo, ano_mestrado AS ano,
         faculdade_mestrado AS faculdade, area_mestrado AS area, link_mestrado AS link
  FROM public.associadas WHERE deletado_em IS NULL AND mestre AND titulo_mestrado IS NOT NULL
  UNION ALL
  SELECT id, nome, 'Tese de Doutorado', 'Tese (Doutorado)',
         titulo_doutorado, ano_doutorado, faculdade_doutorado, area_doutorado, link_doutorado
  FROM public.associadas WHERE deletado_em IS NULL AND doutora AND titulo_doutorado IS NOT NULL
  UNION ALL
  SELECT id, nome, 'Tese de Livre-Docência', 'Tese (Livre-Docência)',
         titulo_livre_docencia, ano_livre_docencia, faculdade_livre_docencia,
         area_livre_docencia, link_livre_docencia
  FROM public.associadas WHERE deletado_em IS NULL AND livre_docente AND titulo_livre_docencia IS NOT NULL
) t;
