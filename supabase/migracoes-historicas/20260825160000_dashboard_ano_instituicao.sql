-- =====================================================================
-- Amplia get_dashboard_stats com duas series que faltavam para o painel:
--   por_ano         — producao bibliografica ao longo do tempo
--   por_instituicao — instituicoes que concentram mais processualistas
--
-- O resto da funcao segue identico; so foram acrescentados dois CTEs e
-- duas chaves no jsonb final.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_dashboard_stats(
  p_uf text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_ibdp boolean DEFAULT NULL::boolean,
  p_abep boolean DEFAULT NULL::boolean,
  p_ranking boolean DEFAULT NULL::boolean,
  p_leciona boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
AS $function$WITH filtered AS (
  SELECT a.*
  FROM public.associadas a
  WHERE a.deletado_em IS NULL
    AND (p_uf IS NULL OR a.uf_atuacao = p_uf)
    AND (p_status IS NULL OR a.status_registro::text = p_status)
    AND (p_ibdp IS NULL OR a.ibdp = p_ibdp)
    AND (p_abep IS NULL OR a.abep = p_abep)
    AND (p_leciona IS NULL OR a.leciona = p_leciona)
    AND (p_ranking IS NULL OR EXISTS (
      SELECT 1 FROM public.vinculos_docentes vd
      WHERE vd.associada_id = a.id AND vd.integra_ranking_40 = p_ranking
    ))
),
kpis AS (
  SELECT
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE ibdp) AS total_ibdp,
    COUNT(*) FILTER (WHERE abep) AS total_abep,
    COUNT(*) FILTER (WHERE leciona) AS total_docentes,
    COUNT(*) FILTER (WHERE doutora) AS total_doutoras,
    COUNT(*) FILTER (WHERE mestre) AS total_mestres,
    COUNT(*) FILTER (WHERE livre_docente) AS total_livre_docentes,
    COUNT(*) FILTER (WHERE especialista) AS total_especialistas
  FROM filtered
),
ranking_count AS (
  SELECT COUNT(DISTINCT vd.associada_id) AS total_ranking_40
  FROM public.vinculos_docentes vd
  WHERE vd.integra_ranking_40 = true
    AND vd.associada_id IN (SELECT id FROM filtered)
),
producoes AS (
  SELECT p.*
  FROM public.producoes_bibliograficas p
  WHERE p.associada_id IN (SELECT id FROM filtered)
),
por_uf AS (
  SELECT jsonb_agg(jsonb_build_object('label', uf_atuacao, 'valor', cnt) ORDER BY cnt DESC)
  FROM (
    SELECT uf_atuacao, COUNT(*) AS cnt
    FROM filtered WHERE uf_atuacao IS NOT NULL
    GROUP BY uf_atuacao ORDER BY cnt DESC
  ) x
),
por_titulacao AS (
  SELECT jsonb_agg(jsonb_build_object('label', lbl, 'valor', val) ORDER BY val DESC)
  FROM (
    VALUES
      ('Doutora', (SELECT COUNT(*) FROM filtered WHERE doutora)),
      ('Mestre', (SELECT COUNT(*) FROM filtered WHERE mestre)),
      ('Livre-Docente', (SELECT COUNT(*) FROM filtered WHERE livre_docente)),
      ('Especialista', (SELECT COUNT(*) FROM filtered WHERE especialista))
  ) t(lbl, val) WHERE val > 0
),
por_tipo_obra AS (
  SELECT jsonb_agg(jsonb_build_object('label', tipo_obra::text, 'valor', cnt) ORDER BY cnt DESC)
  FROM (
    SELECT tipo_obra, COUNT(*) AS cnt FROM producoes
    GROUP BY tipo_obra ORDER BY cnt DESC
  ) x
),
por_area AS (
  SELECT jsonb_agg(jsonb_build_object('label', area_processo::text, 'valor', cnt) ORDER BY cnt DESC)
  FROM (
    SELECT area_processo, COUNT(*) AS cnt FROM producoes
    GROUP BY area_processo ORDER BY cnt DESC
  ) x
),
por_atuacao AS (
  SELECT jsonb_agg(jsonb_build_object('label', atuacao_profissional, 'valor', cnt) ORDER BY cnt DESC)
  FROM (
    SELECT atuacao_profissional, COUNT(*) AS cnt
    FROM filtered WHERE atuacao_profissional IS NOT NULL
    GROUP BY atuacao_profissional ORDER BY cnt DESC LIMIT 10
  ) x
),
-- serie temporal: so anos de 4 digitos (a planilha traz "s/d" em parte das obras)
por_ano AS (
  SELECT jsonb_agg(jsonb_build_object('label', ano, 'valor', cnt) ORDER BY ano)
  FROM (
    SELECT ano_publicacao AS ano, COUNT(*) AS cnt
    FROM producoes
    WHERE ano_publicacao ~ '^(19|20)[0-9]{2}$'
    GROUP BY ano_publicacao
    ORDER BY ano_publicacao
  ) x
),
-- uma associada com dois vinculos na mesma instituicao conta uma vez
por_instituicao AS (
  SELECT jsonb_agg(jsonb_build_object('label', instituicao, 'valor', cnt) ORDER BY cnt DESC)
  FROM (
    SELECT vd.instituicao, COUNT(DISTINCT vd.associada_id) AS cnt
    FROM public.vinculos_docentes vd
    WHERE vd.associada_id IN (SELECT id FROM filtered)
      AND nullif(trim(vd.instituicao), '') IS NOT NULL
    GROUP BY vd.instituicao
    ORDER BY cnt DESC, vd.instituicao
    LIMIT 10
  ) x
)
SELECT jsonb_build_object(
  'kpis', jsonb_build_object(
    'total', (SELECT total FROM kpis),
    'total_ibdp', (SELECT total_ibdp FROM kpis),
    'total_abep', (SELECT total_abep FROM kpis),
    'total_docentes', (SELECT total_docentes FROM kpis),
    'total_doutoras', (SELECT total_doutoras FROM kpis),
    'total_mestres', (SELECT total_mestres FROM kpis),
    'total_livre_docentes', (SELECT total_livre_docentes FROM kpis),
    'total_especialistas', (SELECT total_especialistas FROM kpis),
    'total_ranking_40', (SELECT total_ranking_40 FROM ranking_count),
    'total_producoes', (SELECT COUNT(*) FROM producoes)
  ),
  'por_uf', (SELECT * FROM por_uf),
  'por_titulacao', (SELECT * FROM por_titulacao),
  'por_tipo_obra', (SELECT * FROM por_tipo_obra),
  'por_area', (SELECT * FROM por_area),
  'por_atuacao', (SELECT * FROM por_atuacao),
  'por_ano', (SELECT * FROM por_ano),
  'por_instituicao', (SELECT * FROM por_instituicao)
)$function$;
