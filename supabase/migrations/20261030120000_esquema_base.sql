-- =====================================================================
-- Linha de base: o schema inteiro de produção, como estava em 30/10/2026.
--
-- A base começou pelo painel do Supabase, e as tabelas centrais
-- (associadas, producoes_bibliograficas, vinculos_docentes, perfis...),
-- is_admin()/get_my_role() e o RLS delas nunca viraram migração. As seis
-- migrações seguintes dependiam disso e não aplicavam num banco vazio,
-- o que quebrava `supabase db pull` e impedia montar um ambiente de teste.
--
-- Este arquivo substitui aquelas seis: é o dump de produção (schema
-- public) mais o que mora fora dele — o trigger em auth.users, o bucket
-- `membros` e as políticas do storage. As seis originais seguem em
-- supabase/migracoes-historicas/, para consulta.
--
-- Só schema: nenhum dado de associadas, obras ou páginas vem junto.
-- =====================================================================




SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "unaccent" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."acesso_eletronica_enum" AS ENUM (
    'PUBLICA',
    'PROTEGIDA'
);


ALTER TYPE "public"."acesso_eletronica_enum" OWNER TO "postgres";


CREATE TYPE "public"."area_processo_enum" AS ENUM (
    'P. Civil',
    'P. Penal',
    'P. Trabalhista',
    'P. Tributario',
    'P. Constitucional',
    'Outros',
    'P. Administrativo'
);


ALTER TYPE "public"."area_processo_enum" OWNER TO "postgres";


CREATE TYPE "public"."audit_acao_enum" AS ENUM (
    'CREATE',
    'UPDATE',
    'DELETE'
);


ALTER TYPE "public"."audit_acao_enum" OWNER TO "postgres";


CREATE TYPE "public"."field_type_enum" AS ENUM (
    'string',
    'number',
    'boolean',
    'date',
    'select'
);


ALTER TYPE "public"."field_type_enum" OWNER TO "postgres";


CREATE TYPE "public"."formato_enum" AS ENUM (
    'FISICA',
    'ELETRONICA'
);


ALTER TYPE "public"."formato_enum" OWNER TO "postgres";


CREATE TYPE "public"."role_enum" AS ENUM (
    'ADMIN',
    'ANOTADOR'
);


ALTER TYPE "public"."role_enum" OWNER TO "postgres";


CREATE TYPE "public"."status_registro_enum" AS ENUM (
    'ATIVO',
    'INCOMPLETO',
    'REVISAR',
    'DUPLICADO'
);


ALTER TYPE "public"."status_registro_enum" OWNER TO "postgres";


CREATE TYPE "public"."tipo_obra_enum" AS ENUM (
    'Artigo',
    'Livro',
    'Capitulo de Livro',
    'Anais de Eventos',
    'Coluna em Jornais e Sites',
    'Org. ou Coord.',
    'Dissertação de Mestrado',
    'Tese de Doutorado',
    'Tese de Livre-Docência'
);


ALTER TYPE "public"."tipo_obra_enum" OWNER TO "postgres";


CREATE TYPE "public"."tipo_vinculo_enum" AS ENUM (
    'GRADUACAO',
    'POS'
);


ALTER TYPE "public"."tipo_vinculo_enum" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."area_da_titulacao"("p" "text") RETURNS "public"."area_processo_enum"
    LANGUAGE "sql" IMMUTABLE
    AS $$
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


ALTER FUNCTION "public"."area_da_titulacao"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."buscar_obras"("p_termo" "text" DEFAULT NULL::"text", "p_area" "text" DEFAULT NULL::"text", "p_tipo" "text" DEFAULT NULL::"text", "p_ano" "text" DEFAULT NULL::"text", "p_limite" integer DEFAULT 20, "p_offset" integer DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
  with parametros as (
    select
      nullif(btrim(coalesce(p_termo, '')), '')          as termo,
      least(greatest(coalesce(p_limite, 20), 1), 100)   as limite,
      greatest(coalesce(p_offset, 0), 0)                as deslocamento
  ),
  achadas as (
    select
      p.id,
      p.citacao_completa,
      p.ano_publicacao,
      p.tipo_obra::text     as tipo_obra,
      p.area_processo::text as area_processo,
      p.link_acesso,
      a.id   as associada_id,
      a.nome as associada_nome,
      a.uf_atuacao,
      -- 0 = ano de 4 digitos, 1 = sem data: mantem "s/d" no fim
      case when p.ano_publicacao ~ '^[0-9]{4}$' then 0 else 1 end as sem_data
    from public.producoes_bibliograficas p
    join public.associadas a on a.id = p.associada_id
    cross join parametros par
    where a.deletado_em is null
      and (par.termo is null
           or public.f_unaccent(lower(p.citacao_completa))
              like '%' || public.f_unaccent(lower(par.termo)) || '%')
      and (p_area is null or p.area_processo::text = p_area)
      and (p_tipo is null or p.tipo_obra::text = p_tipo)
      and (p_ano  is null or p.ano_publicacao = p_ano)
  ),
  pagina as (
    select a.*
    from achadas a
    order by a.sem_data, a.ano_publicacao desc, a.associada_nome
    limit  (select limite from parametros)
    offset (select deslocamento from parametros)
  )
  select jsonb_build_object(
    'total', (select count(*) from achadas),
    'obras', (
      select coalesce(
        jsonb_agg(
          to_jsonb(x) - 'sem_data'
          order by x.sem_data, x.ano_publicacao desc, x.associada_nome
        ), '[]'::jsonb)
      from pagina x
    )
  )
$_$;


ALTER FUNCTION "public"."buscar_obras"("p_termo" "text", "p_area" "text", "p_tipo" "text", "p_ano" "text", "p_limite" integer, "p_offset" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."f_unaccent"("text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE STRICT PARALLEL SAFE
    AS $_$ select public.unaccent('public.unaccent'::regdictionary, $1) $_$;


ALTER FUNCTION "public"."f_unaccent"("text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_stats"("p_uf" "text" DEFAULT NULL::"text", "p_status" "text" DEFAULT NULL::"text", "p_ibdp" boolean DEFAULT NULL::boolean, "p_abep" boolean DEFAULT NULL::boolean, "p_ranking" boolean DEFAULT NULL::boolean, "p_leciona" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $_$WITH filtered AS (
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
)$_$;


ALTER FUNCTION "public"."get_dashboard_stats"("p_uf" "text", "p_status" "text", "p_ibdp" boolean, "p_abep" boolean, "p_ranking" boolean, "p_leciona" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "public"."role_enum"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$SELECT role FROM public.perfis WHERE id = auth.uid()$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_numeros_home"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'processualistas', (select count(*) from associadas where deletado_em is null),
    'producoes',       (select count(*) from producoes_bibliograficas),
    'mestrados',       (select count(*) from associadas where mestre and deletado_em is null),
    'doutorados',      (select count(*) from associadas where doutora and deletado_em is null),
    'livre_docencias', (select count(*) from associadas where livre_docente and deletado_em is null),
    'instituicoes',    (select count(distinct instituicao) from vinculos_docentes),
    'ufs',             (select count(distinct uf_atuacao) from associadas where uf_atuacao is not null and deletado_em is null)
  )
$$;


ALTER FUNCTION "public"."get_numeros_home"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ BEGIN INSERT INTO public.perfis (id, nome, role) VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)), COALESCE((NEW.raw_app_meta_data->>'role')::role_enum, 'ANOTADOR')) ON CONFLICT (id) DO NOTHING; RETURN NEW; END; $$;


ALTER FUNCTION "public"."handle_new_auth_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$SELECT EXISTS(SELECT 1 FROM public.perfis WHERE id = auth.uid() AND role = 'ADMIN')$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_associada_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$ BEGIN IF TG_OP = 'INSERT' THEN INSERT INTO public.audit_logs (acao, entidade, entidade_id, detalhes, usuario_id) VALUES ('CREATE', 'Associada', NEW.id, to_jsonb(NEW), auth.uid()); ELSIF TG_OP = 'UPDATE' THEN INSERT INTO public.audit_logs (acao, entidade, entidade_id, detalhes, usuario_id) VALUES ('UPDATE', 'Associada', NEW.id, jsonb_build_object('antes', to_jsonb(OLD), 'depois', to_jsonb(NEW)), auth.uid()); ELSIF TG_OP = 'DELETE' THEN INSERT INTO public.audit_logs (acao, entidade, entidade_id, detalhes, usuario_id) VALUES ('DELETE', 'Associada', OLD.id, to_jsonb(OLD), auth.uid()); END IF; RETURN COALESCE(NEW, OLD); END; $$;


ALTER FUNCTION "public"."log_associada_audit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mesclar_base"("p_associadas" "jsonb", "p_producoes" "jsonb", "p_dry_run" boolean DEFAULT true, "p_remover_ausentes" boolean DEFAULT false, "p_arquivo_nome" "text" DEFAULT NULL::"text", "p_arquivo_tamanho" integer DEFAULT 0, "p_arquivo_hash" "text" DEFAULT NULL::"text", "p_usuario_id" "uuid" DEFAULT NULL::"uuid", "p_usuario_nome" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_antes_assoc int; v_antes_prod int; v_antes_vinc int;
  v_in_assoc int;    v_in_prod int;
  v_match int;       v_novas int;       v_ausentes int;
  v_pessoas_bib int; v_prod_saindo int; v_prod_entrando int; v_prod_orfa int;
  v_prod_ausentes int; v_teses_agora int; v_teses_depois int;
  v_upd int := 0;    v_ins int := 0;    v_del int := 0;
  v_vinc int := 0;   v_prod int := 0;   v_teses int := 0;
  v_ausentes_lista jsonb;
  v_snapshot jsonb;
  v_import_id uuid;
  v_relatorio jsonb;
begin
  -- ---------- validacao de entrada ----------
  if p_associadas is null or jsonb_typeof(p_associadas) <> 'array' then
    raise exception 'p_associadas deve ser um array';
  end if;
  if p_producoes is null or jsonb_typeof(p_producoes) <> 'array' then
    raise exception 'p_producoes deve ser um array';
  end if;

  v_in_assoc := jsonb_array_length(p_associadas);
  v_in_prod  := jsonb_array_length(p_producoes);

  if v_in_assoc = 0 then
    raise exception 'Recusado: a planilha nao contem nenhuma processualista.';
  end if;
  if v_in_assoc > 20000 or v_in_prod > 200000 then
    raise exception 'Recusado: volume acima do limite (% processualistas, % producoes).',
      v_in_assoc, v_in_prod;
  end if;

  select count(*) into v_antes_assoc from associadas where deletado_em is null;
  select count(*) into v_antes_prod  from producoes_bibliograficas;
  select count(*) into v_antes_vinc  from vinculos_docentes;

  -- O guarda-corpo de encolhimento so' faz sentido quando a importacao
  -- pode remover: mesclando, a base nunca diminui.
  if p_remover_ausentes
     and v_antes_assoc > 0
     and v_in_assoc < v_antes_assoc * 0.5
     and coalesce(p_arquivo_hash, '') not like 'FORCE:%' then
    raise exception 'Recusado: a planilha tem % processualistas contra % na base (queda de mais de 50%%) e a remocao das ausentes esta marcada. Confirme explicitamente para prosseguir.',
      v_in_assoc, v_antes_assoc;
  end if;

  -- ---------- staging ----------
  -- As temporarias sao `on commit drop`, o que basta em producao (cada
  -- importacao e' uma transacao). Chamar a funcao duas vezes DENTRO da
  -- mesma transacao, porem, esbarrava em "relation _in_assoc already
  -- exists" -- e e' exatamente o que um teste de idempotencia faz.
  drop table if exists _in_assoc, _in_prod, _cur, _bib, _pos, _map;

  create temp table _in_assoc on commit drop as
  select nome_key(e->>'nome') as k, e as doc from jsonb_array_elements(p_associadas) e;

  if exists (select 1 from _in_assoc group by k having count(*) > 1) then
    raise exception 'Recusado: a planilha tem nomes que colidem apos normalizacao (acentos/caixa/pontuacao).';
  end if;
  if exists (select 1 from _in_assoc where k = '') then
    raise exception 'Recusado: ha linha(s) sem nome na planilha.';
  end if;

  create temp table _in_prod on commit drop as
  select nome_key(e->>'nome_key') as k, e as doc from jsonb_array_elements(p_producoes) e;

  create temp table _cur on commit drop as
  select id, nome, nome_key(nome) as k from associadas where deletado_em is null;

  -- pessoas cuja bibliografia a planilha reescreve: as que aparecem na
  -- aba 2 E existem na aba 1
  create temp table _bib on commit drop as
  select distinct p.k from _in_prod p join _in_assoc i on i.k = p.k;

  select count(*) into v_match     from _cur c join _in_assoc i on i.k = c.k;
  select count(*) into v_novas     from _in_assoc i left join _cur c on c.k = i.k where c.id is null;
  select count(*) into v_ausentes  from _cur c left join _in_assoc i on i.k = c.k where i.k is null;
  select count(*) into v_prod_orfa from _in_prod p left join _in_assoc i on i.k = p.k where i.k is null;
  select count(*) into v_pessoas_bib from _bib;

  select count(*) into v_prod_entrando
  from _in_prod p join _in_assoc i on i.k = p.k
  where nullif(p.doc->>'citacao_completa', '') is not null;

  -- o que sai: a bibliografia atual das pessoas presentes na aba 2, sem
  -- contar as derivadas (recriadas de qualquer jeito no fim)
  select count(*) into v_prod_saindo
  from producoes_bibliograficas pb
  join _cur c on c.id = pb.associada_id
  join _bib b on b.k = c.k
  where pb.tipo_obra not in ('Dissertação de Mestrado', 'Tese de Doutorado', 'Tese de Livre-Docência');

  -- o que sai junto com quem for removida. Sem excluir as derivadas aqui,
  -- as teses dessas pessoas seriam descontadas duas vezes na estimativa:
  -- uma neste total e outra no `- v_teses_agora` logo abaixo -- e a prévia
  -- chegava a anunciar um número negativo de obras.
  select count(*) into v_prod_ausentes
  from producoes_bibliograficas pb
  join _cur c on c.id = pb.associada_id
  where not exists (select 1 from _in_assoc i where i.k = c.k)
    and pb.tipo_obra not in ('Dissertação de Mestrado', 'Tese de Doutorado', 'Tese de Livre-Docência');

  select coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'id', c.id) order by c.nome), '[]'::jsonb)
    into v_ausentes_lista
  from _cur c left join _in_assoc i on i.k = c.k where i.k is null;

  -- quantas obras de titulacao existirao depois: as da planilha mais as
  -- de quem ficou de fora dela e nao vai ser removida
  create temp table _pos on commit drop as
  select coalesce((i.doc->>'mestre')::boolean, false)        as mestre,
         nullif(i.doc->>'titulo_mestrado', '')               as tm,
         coalesce((i.doc->>'doutora')::boolean, false)       as doutora,
         nullif(i.doc->>'titulo_doutorado', '')              as td,
         coalesce((i.doc->>'livre_docente')::boolean, false) as livre,
         nullif(i.doc->>'titulo_livre_docencia', '')         as tl
  from _in_assoc i
  union all
  select a.mestre, a.titulo_mestrado, a.doutora, a.titulo_doutorado,
         a.livre_docente, a.titulo_livre_docencia
  from associadas a
  join _cur c on c.id = a.id
  where not exists (select 1 from _in_assoc i where i.k = c.k)
    and not p_remover_ausentes;

  select count(*) filter (where mestre  and tm is not null)
       + count(*) filter (where doutora and td is not null)
       + count(*) filter (where livre   and tl is not null)
    into v_teses_depois from _pos;

  select count(*) into v_teses_agora
  from producoes_bibliograficas
  where tipo_obra in ('Dissertação de Mestrado', 'Tese de Doutorado', 'Tese de Livre-Docência');

  v_relatorio := jsonb_build_object(
    'remover_ausentes', p_remover_ausentes,
    'antes', jsonb_build_object('associadas', v_antes_assoc, 'producoes', v_antes_prod, 'vinculos', v_antes_vinc),
    'pessoas', jsonb_build_object(
      'atualizadas', v_match,
      'inseridas',   v_novas,
      'ausentes',    v_ausentes,
      'removidas',   case when p_remover_ausentes then v_ausentes else 0 end),
    'bibliografia', jsonb_build_object(
      'pessoas_afetadas', v_pessoas_bib,
      'obras_saindo',     v_prod_saindo + case when p_remover_ausentes then v_prod_ausentes else 0 end,
      'obras_entrando',   v_prod_entrando,
      'sem_dona',         v_prod_orfa,
      'teses_derivadas',  v_teses_depois),
    'lista_ausentes', v_ausentes_lista
  );

  if p_dry_run then
    return v_relatorio || jsonb_build_object(
      'dry_run', true,
      'depois', jsonb_build_object(
        'associadas', v_antes_assoc + v_novas - case when p_remover_ausentes then v_ausentes else 0 end,
        'producoes',  v_antes_prod - v_prod_saindo + v_prod_entrando
                      - case when p_remover_ausentes then v_prod_ausentes else 0 end
                      - v_teses_agora + v_teses_depois,
        'vinculos',   null));
  end if;

  -- ---------- snapshot do estado atual (mesma transacao) ----------
  select jsonb_build_object(
           'tirado_em', now(),
           'associadas', (select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) from associadas a),
           'producoes',  (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from producoes_bibliograficas p),
           'vinculos',   (select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) from vinculos_docentes v),
           'notas',      (select coalesce(jsonb_agg(to_jsonb(n)), '[]'::jsonb) from notas n)
         )
    into v_snapshot;

  -- ---------- cadastro ----------
  update associadas a set
    nome = i.doc->>'nome',
    email = nullif(i.doc->>'email',''),
    status_registro = coalesce((i.doc->>'status_registro')::status_registro_enum,'ATIVO'),
    uf_atuacao = nullif(i.doc->>'uf_atuacao',''),
    atuacao_profissional = nullif(i.doc->>'atuacao_profissional',''),
    ibdp = coalesce((i.doc->>'ibdp')::boolean,false),
    abep = coalesce((i.doc->>'abep')::boolean,false),
    leciona = coalesce((i.doc->>'leciona')::boolean,false),
    link_lattes = nullif(i.doc->>'link_lattes',''),
    data_atualizacao_lattes = (nullif(i.doc->>'data_atualizacao_lattes',''))::date,
    especialista = coalesce((i.doc->>'especialista')::boolean,false),
    mestre = coalesce((i.doc->>'mestre')::boolean,false),
    titulo_mestrado = nullif(i.doc->>'titulo_mestrado',''),
    ano_mestrado = nullif(i.doc->>'ano_mestrado',''),
    faculdade_mestrado = nullif(i.doc->>'faculdade_mestrado',''),
    area_mestrado = nullif(i.doc->>'area_mestrado',''),
    link_mestrado = nullif(i.doc->>'link_mestrado',''),
    doutora = coalesce((i.doc->>'doutora')::boolean,false),
    titulo_doutorado = nullif(i.doc->>'titulo_doutorado',''),
    ano_doutorado = nullif(i.doc->>'ano_doutorado',''),
    faculdade_doutorado = nullif(i.doc->>'faculdade_doutorado',''),
    area_doutorado = nullif(i.doc->>'area_doutorado',''),
    link_doutorado = nullif(i.doc->>'link_doutorado',''),
    livre_docente = coalesce((i.doc->>'livre_docente')::boolean,false),
    titulo_livre_docencia = nullif(i.doc->>'titulo_livre_docencia',''),
    ano_livre_docencia = nullif(i.doc->>'ano_livre_docencia',''),
    faculdade_livre_docencia = nullif(i.doc->>'faculdade_livre_docencia',''),
    area_livre_docencia = nullif(i.doc->>'area_livre_docencia',''),
    link_livre_docencia = nullif(i.doc->>'link_livre_docencia',''),
    atualizado_em = now()
  from _in_assoc i, _cur c
  where c.k = i.k and a.id = c.id;
  get diagnostics v_upd = row_count;

  if p_remover_ausentes then
    -- producoes, vinculos e notas somem por cascade
    delete from associadas a using _cur c
    where a.id = c.id and not exists (select 1 from _in_assoc i where i.k = c.k);
    get diagnostics v_del = row_count;
  end if;

  with novas as (
    select i.doc d from _in_assoc i left join _cur c on c.k = i.k where c.id is null
  )
  insert into associadas (
    nome, email, status_registro, uf_atuacao, atuacao_profissional,
    ibdp, abep, leciona, link_lattes, data_atualizacao_lattes,
    especialista, mestre, titulo_mestrado, ano_mestrado, faculdade_mestrado, area_mestrado, link_mestrado,
    doutora, titulo_doutorado, ano_doutorado, faculdade_doutorado, area_doutorado, link_doutorado,
    livre_docente, titulo_livre_docencia, ano_livre_docencia, faculdade_livre_docencia,
    area_livre_docencia, link_livre_docencia
  )
  select
    d->>'nome', nullif(d->>'email',''),
    coalesce((d->>'status_registro')::status_registro_enum,'ATIVO'),
    nullif(d->>'uf_atuacao',''), nullif(d->>'atuacao_profissional',''),
    coalesce((d->>'ibdp')::boolean,false), coalesce((d->>'abep')::boolean,false),
    coalesce((d->>'leciona')::boolean,false),
    nullif(d->>'link_lattes',''), (nullif(d->>'data_atualizacao_lattes',''))::date,
    coalesce((d->>'especialista')::boolean,false), coalesce((d->>'mestre')::boolean,false),
    nullif(d->>'titulo_mestrado',''), nullif(d->>'ano_mestrado',''), nullif(d->>'faculdade_mestrado',''),
    nullif(d->>'area_mestrado',''), nullif(d->>'link_mestrado',''),
    coalesce((d->>'doutora')::boolean,false),
    nullif(d->>'titulo_doutorado',''), nullif(d->>'ano_doutorado',''), nullif(d->>'faculdade_doutorado',''),
    nullif(d->>'area_doutorado',''), nullif(d->>'link_doutorado',''),
    coalesce((d->>'livre_docente')::boolean,false),
    nullif(d->>'titulo_livre_docencia',''), nullif(d->>'ano_livre_docencia',''),
    nullif(d->>'faculdade_livre_docencia',''), nullif(d->>'area_livre_docencia',''),
    nullif(d->>'link_livre_docencia','')
  from novas;
  get diagnostics v_ins = row_count;

  create temp table _map on commit drop as
  select id, nome_key(nome) as k from associadas where deletado_em is null;

  -- ---------- vinculos: escopo das pessoas da aba 1 ----------
  delete from vinculos_docentes v using _map m, _in_assoc i
  where v.associada_id = m.id and m.k = i.k;

  insert into vinculos_docentes (associada_id, tipo, instituicao, integra_ranking_40)
  select m.id,
         coalesce((v->>'tipo')::tipo_vinculo_enum,'GRADUACAO'),
         v->>'instituicao',
         coalesce((v->>'integra_ranking_40')::boolean,false)
  from _in_assoc i
  join _map m on m.k = i.k
  cross join lateral jsonb_array_elements(coalesce(i.doc->'vinculos_docentes','[]'::jsonb)) v
  where nullif(v->>'instituicao','') is not null;
  get diagnostics v_vinc = row_count;

  -- ---------- bibliografia: escopo das pessoas da aba 2 ----------
  delete from producoes_bibliograficas pb using _map m, _bib b
  where pb.associada_id = m.id and m.k = b.k;

  insert into producoes_bibliograficas
    (associada_id, tipo_obra, citacao_completa, ano_publicacao, area_processo, formato)
  select m.id,
         (p.doc->>'tipo_obra')::tipo_obra_enum,
         p.doc->>'citacao_completa',
         p.doc->>'ano_publicacao',
         (p.doc->>'area_processo')::area_processo_enum,
         coalesce((p.doc->>'formato')::formato_enum,'ELETRONICA')
  from _in_prod p join _map m on m.k = p.k
  where nullif(p.doc->>'citacao_completa','') is not null;
  get diagnostics v_prod = row_count;

  -- ---------- teses e dissertacoes, sempre por ultimo ----------
  v_teses := sincronizar_obras_de_titulacao();

  -- ---------- historico + auditoria ----------
  v_relatorio := v_relatorio || jsonb_build_object(
    'aplicado', jsonb_build_object(
      'atualizadas', v_upd, 'inseridas', v_ins, 'removidas', v_del,
      'obras_da_planilha', v_prod, 'teses_derivadas', v_teses, 'vinculos', v_vinc),
    'depois', jsonb_build_object(
      'associadas', (select count(*) from associadas where deletado_em is null),
      'producoes',  (select count(*) from producoes_bibliograficas),
      'vinculos',   (select count(*) from vinculos_docentes))
  );

  insert into importacoes
    (usuario_id, usuario_nome, arquivo_nome, arquivo_tamanho, arquivo_hash, status, relatorio, snapshot)
  values (
    p_usuario_id, p_usuario_nome,
    coalesce(p_arquivo_nome, 'planilha.xlsx'), coalesce(p_arquivo_tamanho, 0), p_arquivo_hash,
    'APLICADA', v_relatorio, v_snapshot
  )
  returning id into v_import_id;

  if p_usuario_id is not null then
    insert into audit_logs (acao, entidade, entidade_id, detalhes, usuario_id)
    values ('UPDATE', 'BASE_COMPLETA', v_import_id,
            jsonb_build_object('origem','planilha','arquivo',p_arquivo_nome,
                               'remover_ausentes', p_remover_ausentes,
                               'atualizadas',v_upd,'inseridas',v_ins,'removidas',v_del,
                               'producoes',v_prod,'teses',v_teses,'vinculos',v_vinc),
            p_usuario_id);
  end if;

  -- cada snapshot pesa alguns MB; guarda so' os 5 mais recentes
  update importacoes set snapshot = null
  where snapshot is not null
    and id not in (select id from importacoes where snapshot is not null order by criado_em desc limit 5);

  return v_relatorio || jsonb_build_object('dry_run', false, 'importacao_id', v_import_id);
end;
$$;


ALTER FUNCTION "public"."mesclar_base"("p_associadas" "jsonb", "p_producoes" "jsonb", "p_dry_run" boolean, "p_remover_ausentes" boolean, "p_arquivo_nome" "text", "p_arquivo_tamanho" integer, "p_arquivo_hash" "text", "p_usuario_id" "uuid", "p_usuario_nome" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."nome_key"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public', 'extensions'
    AS $$
  select trim(regexp_replace(
           regexp_replace(lower(unaccent(coalesce(p, ''))), '[^a-z ]', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;


ALTER FUNCTION "public"."nome_key"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverter_importacao"("p_id" "uuid", "p_usuario_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare
  v_snap jsonb;
  v_status text;
  v_a int; v_p int; v_v int; v_n int;
begin
  select snapshot, status into v_snap, v_status from importacoes where id = p_id;

  if v_snap is null then
    raise exception 'Importacao % nao tem snapshot disponivel (pode ter sido descartado por idade).', p_id;
  end if;
  if v_status = 'REVERTIDA' then
    raise exception 'Importacao % ja foi revertida.', p_id;
  end if;

  -- ordem importa: filhos antes dos pais
  delete from notas where true;
  delete from producoes_bibliograficas where true;
  delete from vinculos_docentes where true;
  delete from associadas where true;

  insert into associadas select * from jsonb_populate_recordset(null::associadas, v_snap->'associadas');
  get diagnostics v_a = row_count;
  insert into vinculos_docentes select * from jsonb_populate_recordset(null::vinculos_docentes, v_snap->'vinculos');
  get diagnostics v_v = row_count;
  insert into producoes_bibliograficas select * from jsonb_populate_recordset(null::producoes_bibliograficas, v_snap->'producoes');
  get diagnostics v_p = row_count;
  insert into notas select * from jsonb_populate_recordset(null::notas, v_snap->'notas');
  get diagnostics v_n = row_count;

  update importacoes
     set status = 'REVERTIDA', revertida_em = now(), revertida_por = p_usuario_id
   where id = p_id;

  if p_usuario_id is not null then
    insert into audit_logs (acao, entidade, entidade_id, detalhes, usuario_id)
    values ('UPDATE','BASE_COMPLETA', p_id,
            jsonb_build_object('origem','rollback','restaurado',
              jsonb_build_object('associadas',v_a,'producoes',v_p,'vinculos',v_v,'notas',v_n)),
            p_usuario_id);
  end if;

  return jsonb_build_object('revertida', true, 'importacao_id', p_id,
    'restaurado', jsonb_build_object('associadas',v_a,'producoes',v_p,'vinculos',v_v,'notas',v_n));
end;
$$;


ALTER FUNCTION "public"."reverter_importacao"("p_id" "uuid", "p_usuario_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sem_pontuacao_final"("p" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
  SELECT nullif(btrim(regexp_replace(btrim(coalesce(p, '')), '[.,;]+$', '')), '')
$_$;


ALTER FUNCTION "public"."sem_pontuacao_final"("p" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$ BEGIN NEW.atualizado_em = now(); RETURN NEW; END; $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sincronizar_obras_de_titulacao"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
declare v_n int;
begin
  delete from producoes_bibliograficas
  where tipo_obra in ('Dissertação de Mestrado', 'Tese de Doutorado', 'Tese de Livre-Docência');

  insert into producoes_bibliograficas
    (associada_id, tipo_obra, citacao_completa, ano_publicacao, area_processo, formato, link_acesso)
  select
    t.id,
    t.tipo::tipo_obra_enum,
    t.nome || '. ' || sem_pontuacao_final(t.titulo) || '. ' || t.mencao ||
      coalesce(' — ' || nullif(concat_ws(', ', sem_pontuacao_final(t.faculdade), nullif(t.ano, '')), ''), '') || '.',
    coalesce(nullif(t.ano, ''), 's/d'),
    area_da_titulacao(t.area),
    'ELETRONICA'::formato_enum,
    t.link
  from (
    select id, nome, 'Dissertação de Mestrado' as tipo, 'Dissertação (Mestrado)' as mencao,
           titulo_mestrado as titulo, ano_mestrado as ano,
           faculdade_mestrado as faculdade, area_mestrado as area, link_mestrado as link
    from associadas where deletado_em is null and mestre and titulo_mestrado is not null
    union all
    select id, nome, 'Tese de Doutorado', 'Tese (Doutorado)',
           titulo_doutorado, ano_doutorado, faculdade_doutorado, area_doutorado, link_doutorado
    from associadas where deletado_em is null and doutora and titulo_doutorado is not null
    union all
    select id, nome, 'Tese de Livre-Docência', 'Tese (Livre-Docência)',
           titulo_livre_docencia, ano_livre_docencia, faculdade_livre_docencia,
           area_livre_docencia, link_livre_docencia
    from associadas where deletado_em is null and livre_docente and titulo_livre_docencia is not null
  ) t;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


ALTER FUNCTION "public"."sincronizar_obras_de_titulacao"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_atualizado_em"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;


ALTER FUNCTION "public"."touch_atualizado_em"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."associadas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "email" "text",
    "status_registro" "public"."status_registro_enum" DEFAULT 'ATIVO'::"public"."status_registro_enum" NOT NULL,
    "leciona" boolean DEFAULT false NOT NULL,
    "atuacao_profissional" "text",
    "uf_atuacao" character(2),
    "ibdp" boolean DEFAULT false NOT NULL,
    "abep" boolean DEFAULT false NOT NULL,
    "link_lattes" "text",
    "data_atualizacao_lattes" "date",
    "especialista" boolean DEFAULT false NOT NULL,
    "mestre" boolean DEFAULT false NOT NULL,
    "titulo_mestrado" "text",
    "ano_mestrado" "text",
    "faculdade_mestrado" "text",
    "area_mestrado" "text",
    "link_mestrado" "text",
    "doutora" boolean DEFAULT false NOT NULL,
    "titulo_doutorado" "text",
    "ano_doutorado" "text",
    "faculdade_doutorado" "text",
    "area_doutorado" "text",
    "link_doutorado" "text",
    "livre_docente" boolean DEFAULT false NOT NULL,
    "titulo_livre_docencia" "text",
    "ano_livre_docencia" "text",
    "faculdade_livre_docencia" "text",
    "area_livre_docencia" "text",
    "link_livre_docencia" "text",
    "dados_extras" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "deletado_em" timestamp with time zone,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."associadas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "acao" "public"."audit_acao_enum" NOT NULL,
    "entidade" "text" NOT NULL,
    "entidade_id" "uuid",
    "detalhes" "jsonb",
    "usuario_id" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."definicoes_campos_extras" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "entidade" "text" NOT NULL,
    "nome_campo" "text" NOT NULL,
    "label" "text" NOT NULL,
    "tipo" "public"."field_type_enum" DEFAULT 'string'::"public"."field_type_enum" NOT NULL,
    "obrigatorio" boolean DEFAULT false NOT NULL,
    "opcoes" "jsonb",
    "ordem" integer DEFAULT 0 NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "definicoes_campos_extras_entidade_check" CHECK (("entidade" = ANY (ARRAY['Associada'::"text", 'ProducaoBibliografica'::"text"])))
);


ALTER TABLE "public"."definicoes_campos_extras" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."definicoes_tabelas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "descricao" "text",
    "icone" "text" DEFAULT 'table'::"text",
    "schema" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "visivel_dashboard" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."definicoes_tabelas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."grupos_membros" (
    "nome" "text" NOT NULL,
    "ordem" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."grupos_membros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."importacoes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "usuario_id" "uuid",
    "usuario_nome" "text",
    "arquivo_nome" "text" NOT NULL,
    "arquivo_tamanho" integer NOT NULL,
    "arquivo_hash" "text",
    "status" "text" DEFAULT 'APLICADA'::"text" NOT NULL,
    "relatorio" "jsonb",
    "snapshot" "jsonb",
    "revertida_em" timestamp with time zone,
    "revertida_por" "uuid",
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "importacoes_status_check" CHECK (("status" = ANY (ARRAY['APLICADA'::"text", 'REVERTIDA'::"text", 'ERRO'::"text"])))
);


ALTER TABLE "public"."importacoes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."membros" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "nome" "text" NOT NULL,
    "funcao" "text",
    "grupo" "text" DEFAULT 'Integrantes'::"text" NOT NULL,
    "bio" "text",
    "foto_url" "text",
    "lattes_url" "text",
    "ordem" integer DEFAULT 0 NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."membros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "texto" "text" NOT NULL,
    "associada_id" "uuid" NOT NULL,
    "autor_id" "uuid" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."paginas" (
    "slug" "text" NOT NULL,
    "titulo" "text" NOT NULL,
    "subtitulo" "text",
    "conteudo" "text" DEFAULT ''::"text" NOT NULL,
    "ordem" integer DEFAULT 0 NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_por" "uuid"
);


ALTER TABLE "public"."paginas" OWNER TO "postgres";


COMMENT ON COLUMN "public"."paginas"."conteudo" IS 'Markdown: ## titulo, ### subtitulo, **negrito**, *italico*, listas com -, [link](url)';



CREATE TABLE IF NOT EXISTS "public"."perfis" (
    "id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "role" "public"."role_enum" DEFAULT 'ANOTADOR'::"public"."role_enum" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."perfis" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."producoes_bibliograficas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "associada_id" "uuid" NOT NULL,
    "tipo_obra" "public"."tipo_obra_enum" NOT NULL,
    "citacao_completa" "text" NOT NULL,
    "ano_publicacao" "text" NOT NULL,
    "area_processo" "public"."area_processo_enum" NOT NULL,
    "formato" "public"."formato_enum" NOT NULL,
    "acesso_eletronica" "public"."acesso_eletronica_enum",
    "localizacao" "text",
    "link_acesso" "text",
    "dados_extras" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."producoes_bibliograficas" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."registros_dinamicos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tabela_id" "uuid" NOT NULL,
    "associada_id" "uuid",
    "dados" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."registros_dinamicos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vinculos_docentes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "associada_id" "uuid" NOT NULL,
    "tipo" "public"."tipo_vinculo_enum" NOT NULL,
    "instituicao" "text" NOT NULL,
    "integra_ranking_40" boolean DEFAULT false NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."vinculos_docentes" OWNER TO "postgres";


ALTER TABLE ONLY "public"."associadas"
    ADD CONSTRAINT "associadas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."definicoes_campos_extras"
    ADD CONSTRAINT "definicoes_campos_extras_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."definicoes_tabelas"
    ADD CONSTRAINT "definicoes_tabelas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."grupos_membros"
    ADD CONSTRAINT "grupos_membros_pkey" PRIMARY KEY ("nome");



ALTER TABLE ONLY "public"."importacoes"
    ADD CONSTRAINT "importacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."membros"
    ADD CONSTRAINT "membros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notas"
    ADD CONSTRAINT "notas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."paginas"
    ADD CONSTRAINT "paginas_pkey" PRIMARY KEY ("slug");



ALTER TABLE ONLY "public"."perfis"
    ADD CONSTRAINT "perfis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."producoes_bibliograficas"
    ADD CONSTRAINT "producoes_bibliograficas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."registros_dinamicos"
    ADD CONSTRAINT "registros_dinamicos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vinculos_docentes"
    ADD CONSTRAINT "vinculos_docentes_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_assoc_deletado" ON "public"."associadas" USING "btree" ("deletado_em");



CREATE INDEX "idx_assoc_email" ON "public"."associadas" USING "btree" ("email") WHERE ("deletado_em" IS NULL);



CREATE INDEX "idx_assoc_nome" ON "public"."associadas" USING "btree" ("nome") WHERE ("deletado_em" IS NULL);



CREATE INDEX "idx_assoc_status" ON "public"."associadas" USING "btree" ("status_registro") WHERE ("deletado_em" IS NULL);



CREATE INDEX "idx_assoc_uf" ON "public"."associadas" USING "btree" ("uf_atuacao") WHERE ("deletado_em" IS NULL);



CREATE INDEX "idx_audit_criado" ON "public"."audit_logs" USING "btree" ("criado_em" DESC);



CREATE INDEX "idx_audit_entidade" ON "public"."audit_logs" USING "btree" ("entidade", "entidade_id");



CREATE INDEX "idx_audit_usuario" ON "public"."audit_logs" USING "btree" ("usuario_id");



CREATE INDEX "idx_prod_ano" ON "public"."producoes_bibliograficas" USING "btree" ("ano_publicacao");



CREATE INDEX "idx_prod_area" ON "public"."producoes_bibliograficas" USING "btree" ("area_processo");



CREATE INDEX "idx_prod_associada" ON "public"."producoes_bibliograficas" USING "btree" ("associada_id");



CREATE INDEX "idx_prod_tipo" ON "public"."producoes_bibliograficas" USING "btree" ("tipo_obra");



CREATE INDEX "idx_reg_associada" ON "public"."registros_dinamicos" USING "btree" ("associada_id");



CREATE INDEX "idx_reg_tabela" ON "public"."registros_dinamicos" USING "btree" ("tabela_id");



CREATE INDEX "idx_vinc_associada" ON "public"."vinculos_docentes" USING "btree" ("associada_id");



CREATE INDEX "idx_vinc_ranking" ON "public"."vinculos_docentes" USING "btree" ("integra_ranking_40");



CREATE INDEX "importacoes_criado_em_idx" ON "public"."importacoes" USING "btree" ("criado_em" DESC);



CREATE INDEX "membros_grupo_ordem_idx" ON "public"."membros" USING "btree" ("grupo", "ordem", "nome");



CREATE INDEX "producoes_ano_idx" ON "public"."producoes_bibliograficas" USING "btree" ("ano_publicacao");



CREATE INDEX "producoes_citacao_trgm_idx" ON "public"."producoes_bibliograficas" USING "gin" ("public"."f_unaccent"("lower"("citacao_completa")) "public"."gin_trgm_ops");



CREATE OR REPLACE TRIGGER "membros_touch" BEFORE UPDATE ON "public"."membros" FOR EACH ROW EXECUTE FUNCTION "public"."touch_atualizado_em"();



CREATE OR REPLACE TRIGGER "paginas_touch" BEFORE UPDATE ON "public"."paginas" FOR EACH ROW EXECUTE FUNCTION "public"."touch_atualizado_em"();



CREATE OR REPLACE TRIGGER "trg_associadas_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."associadas" FOR EACH ROW EXECUTE FUNCTION "public"."log_associada_audit"();



CREATE OR REPLACE TRIGGER "trg_associadas_updated_at" BEFORE UPDATE ON "public"."associadas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_def_tabelas_updated_at" BEFORE UPDATE ON "public"."definicoes_tabelas" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_registros_din_updated_at" BEFORE UPDATE ON "public"."registros_dinamicos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "public"."perfis"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."importacoes"
    ADD CONSTRAINT "importacoes_revertida_por_fkey" FOREIGN KEY ("revertida_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."importacoes"
    ADD CONSTRAINT "importacoes_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notas"
    ADD CONSTRAINT "notas_associada_id_fkey" FOREIGN KEY ("associada_id") REFERENCES "public"."associadas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notas"
    ADD CONSTRAINT "notas_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "public"."perfis"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."paginas"
    ADD CONSTRAINT "paginas_atualizado_por_fkey" FOREIGN KEY ("atualizado_por") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."perfis"
    ADD CONSTRAINT "perfis_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."producoes_bibliograficas"
    ADD CONSTRAINT "producoes_bibliograficas_associada_id_fkey" FOREIGN KEY ("associada_id") REFERENCES "public"."associadas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."registros_dinamicos"
    ADD CONSTRAINT "registros_dinamicos_associada_id_fkey" FOREIGN KEY ("associada_id") REFERENCES "public"."associadas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."registros_dinamicos"
    ADD CONSTRAINT "registros_dinamicos_tabela_id_fkey" FOREIGN KEY ("tabela_id") REFERENCES "public"."definicoes_tabelas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vinculos_docentes"
    ADD CONSTRAINT "vinculos_docentes_associada_id_fkey" FOREIGN KEY ("associada_id") REFERENCES "public"."associadas"("id") ON DELETE CASCADE;



CREATE POLICY "assoc_delete_admin" ON "public"."associadas" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "assoc_insert_anotador" ON "public"."associadas" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['ADMIN'::"public"."role_enum", 'ANOTADOR'::"public"."role_enum"])));



CREATE POLICY "assoc_select_auth" ON "public"."associadas" FOR SELECT TO "authenticated" USING ((("deletado_em" IS NULL) OR "public"."is_admin"()));



CREATE POLICY "assoc_select_public" ON "public"."associadas" FOR SELECT TO "anon" USING (("deletado_em" IS NULL));



CREATE POLICY "assoc_update_admin" ON "public"."associadas" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."associadas" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_select_admin" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "defcampo_delete_admin" ON "public"."definicoes_campos_extras" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "defcampo_insert_admin" ON "public"."definicoes_campos_extras" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "defcampo_select_auth" ON "public"."definicoes_campos_extras" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "defcampo_select_public" ON "public"."definicoes_campos_extras" FOR SELECT TO "anon" USING (true);



CREATE POLICY "defcampo_update_admin" ON "public"."definicoes_campos_extras" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."definicoes_campos_extras" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."definicoes_tabelas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deftab_delete_admin" ON "public"."definicoes_tabelas" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "deftab_insert_admin" ON "public"."definicoes_tabelas" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "deftab_select_auth" ON "public"."definicoes_tabelas" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "deftab_select_public" ON "public"."definicoes_tabelas" FOR SELECT TO "anon" USING (true);



CREATE POLICY "deftab_update_admin" ON "public"."definicoes_tabelas" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "grupos_escrita_admin" ON "public"."grupos_membros" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "grupos_leitura_publica" ON "public"."grupos_membros" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."grupos_membros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."importacoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "importacoes_select_admin" ON "public"."importacoes" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."membros" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "membros_escrita_admin" ON "public"."membros" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "membros_leitura_publica" ON "public"."membros" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."notas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notas_delete_admin" ON "public"."notas" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "notas_insert_auth" ON "public"."notas" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_my_role"() = ANY (ARRAY['ADMIN'::"public"."role_enum", 'ANOTADOR'::"public"."role_enum"])) AND ("autor_id" = "auth"."uid"())));



CREATE POLICY "notas_select_auth" ON "public"."notas" FOR SELECT TO "authenticated" USING ((("autor_id" = "auth"."uid"()) OR "public"."is_admin"()));



ALTER TABLE "public"."paginas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "paginas_escrita_admin" ON "public"."paginas" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "paginas_leitura_publica" ON "public"."paginas" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."perfis" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "perfis_delete_admin" ON "public"."perfis" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "perfis_select_own" ON "public"."perfis" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "perfis_update_admin" ON "public"."perfis" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "prod_delete_admin" ON "public"."producoes_bibliograficas" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "prod_insert_anotador" ON "public"."producoes_bibliograficas" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['ADMIN'::"public"."role_enum", 'ANOTADOR'::"public"."role_enum"])));



CREATE POLICY "prod_select_auth" ON "public"."producoes_bibliograficas" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "prod_select_public" ON "public"."producoes_bibliograficas" FOR SELECT TO "anon" USING (true);



CREATE POLICY "prod_update_admin" ON "public"."producoes_bibliograficas" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."producoes_bibliograficas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "regdin_delete_admin" ON "public"."registros_dinamicos" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "regdin_insert_anotador" ON "public"."registros_dinamicos" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['ADMIN'::"public"."role_enum", 'ANOTADOR'::"public"."role_enum"])));



CREATE POLICY "regdin_select_auth" ON "public"."registros_dinamicos" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "regdin_select_public" ON "public"."registros_dinamicos" FOR SELECT TO "anon" USING (true);



CREATE POLICY "regdin_update_admin" ON "public"."registros_dinamicos" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."registros_dinamicos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "vinc_delete_admin" ON "public"."vinculos_docentes" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "vinc_insert_anotador" ON "public"."vinculos_docentes" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_my_role"() = ANY (ARRAY['ADMIN'::"public"."role_enum", 'ANOTADOR'::"public"."role_enum"])));



CREATE POLICY "vinc_select_auth" ON "public"."vinculos_docentes" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "vinc_select_public" ON "public"."vinculos_docentes" FOR SELECT TO "anon" USING (true);



CREATE POLICY "vinc_update_admin" ON "public"."vinculos_docentes" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



ALTER TABLE "public"."vinculos_docentes" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_in"("cstring") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_out"("public"."gtrgm") TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."area_da_titulacao"("p" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."area_da_titulacao"("p" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."area_da_titulacao"("p" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."buscar_obras"("p_termo" "text", "p_area" "text", "p_tipo" "text", "p_ano" "text", "p_limite" integer, "p_offset" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."buscar_obras"("p_termo" "text", "p_area" "text", "p_tipo" "text", "p_ano" "text", "p_limite" integer, "p_offset" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."buscar_obras"("p_termo" "text", "p_area" "text", "p_tipo" "text", "p_ano" "text", "p_limite" integer, "p_offset" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."f_unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."f_unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."f_unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_uf" "text", "p_status" "text", "p_ibdp" boolean, "p_abep" boolean, "p_ranking" boolean, "p_leciona" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_uf" "text", "p_status" "text", "p_ibdp" boolean, "p_abep" boolean, "p_ranking" boolean, "p_leciona" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_stats"("p_uf" "text", "p_status" "text", "p_ibdp" boolean, "p_abep" boolean, "p_ranking" boolean, "p_leciona" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_numeros_home"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_numeros_home"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_numeros_home"() TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_query_trgm"("text", "internal", smallint, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_extract_value_trgm"("text", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_consistent"("internal", smallint, "text", integer, "internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gin_trgm_triconsistent"("internal", smallint, "text", integer, "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_compress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_consistent"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_decompress"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_distance"("internal", "text", smallint, "oid", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_options"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_penalty"("internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_picksplit"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_same"("public"."gtrgm", "public"."gtrgm", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."gtrgm_union"("internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."log_associada_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."log_associada_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_associada_audit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mesclar_base"("p_associadas" "jsonb", "p_producoes" "jsonb", "p_dry_run" boolean, "p_remover_ausentes" boolean, "p_arquivo_nome" "text", "p_arquivo_tamanho" integer, "p_arquivo_hash" "text", "p_usuario_id" "uuid", "p_usuario_nome" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mesclar_base"("p_associadas" "jsonb", "p_producoes" "jsonb", "p_dry_run" boolean, "p_remover_ausentes" boolean, "p_arquivo_nome" "text", "p_arquivo_tamanho" integer, "p_arquivo_hash" "text", "p_usuario_id" "uuid", "p_usuario_nome" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."nome_key"("p" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."nome_key"("p" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."nome_key"("p" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reverter_importacao"("p_id" "uuid", "p_usuario_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reverter_importacao"("p_id" "uuid", "p_usuario_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sem_pontuacao_final"("p" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sem_pontuacao_final"("p" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sem_pontuacao_final"("p" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "postgres";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "anon";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_limit"(real) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_limit"() TO "postgres";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."show_trgm"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_dist"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."similarity_op"("text", "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sincronizar_obras_de_titulacao"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sincronizar_obras_de_titulacao"() TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."strict_word_similarity_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_atualizado_em"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_atualizado_em"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_atualizado_em"() TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent"("regdictionary", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_init"("internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "postgres";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "anon";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "authenticated";
GRANT ALL ON FUNCTION "public"."unaccent_lexize"("internal", "internal", "internal", "internal") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_commutator_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_dist_op"("text", "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "postgres";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "anon";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."word_similarity_op"("text", "text") TO "service_role";


















GRANT ALL ON TABLE "public"."associadas" TO "anon";
GRANT ALL ON TABLE "public"."associadas" TO "authenticated";
GRANT ALL ON TABLE "public"."associadas" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."definicoes_campos_extras" TO "anon";
GRANT ALL ON TABLE "public"."definicoes_campos_extras" TO "authenticated";
GRANT ALL ON TABLE "public"."definicoes_campos_extras" TO "service_role";



GRANT ALL ON TABLE "public"."definicoes_tabelas" TO "anon";
GRANT ALL ON TABLE "public"."definicoes_tabelas" TO "authenticated";
GRANT ALL ON TABLE "public"."definicoes_tabelas" TO "service_role";



GRANT ALL ON TABLE "public"."grupos_membros" TO "anon";
GRANT ALL ON TABLE "public"."grupos_membros" TO "authenticated";
GRANT ALL ON TABLE "public"."grupos_membros" TO "service_role";



GRANT ALL ON TABLE "public"."importacoes" TO "anon";
GRANT ALL ON TABLE "public"."importacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."importacoes" TO "service_role";



GRANT ALL ON TABLE "public"."membros" TO "anon";
GRANT ALL ON TABLE "public"."membros" TO "authenticated";
GRANT ALL ON TABLE "public"."membros" TO "service_role";



GRANT ALL ON TABLE "public"."notas" TO "anon";
GRANT ALL ON TABLE "public"."notas" TO "authenticated";
GRANT ALL ON TABLE "public"."notas" TO "service_role";



GRANT ALL ON TABLE "public"."paginas" TO "anon";
GRANT ALL ON TABLE "public"."paginas" TO "authenticated";
GRANT ALL ON TABLE "public"."paginas" TO "service_role";



GRANT ALL ON TABLE "public"."perfis" TO "anon";
GRANT ALL ON TABLE "public"."perfis" TO "authenticated";
GRANT ALL ON TABLE "public"."perfis" TO "service_role";



GRANT ALL ON TABLE "public"."producoes_bibliograficas" TO "anon";
GRANT ALL ON TABLE "public"."producoes_bibliograficas" TO "authenticated";
GRANT ALL ON TABLE "public"."producoes_bibliograficas" TO "service_role";



GRANT ALL ON TABLE "public"."registros_dinamicos" TO "anon";
GRANT ALL ON TABLE "public"."registros_dinamicos" TO "authenticated";
GRANT ALL ON TABLE "public"."registros_dinamicos" TO "service_role";



GRANT ALL ON TABLE "public"."vinculos_docentes" TO "anon";
GRANT ALL ON TABLE "public"."vinculos_docentes" TO "authenticated";
GRANT ALL ON TABLE "public"."vinculos_docentes" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


-- --------------------------------------------- fora do schema public

-- cria o perfil de quem se cadastra (ver handle_new_auth_user)
CREATE OR REPLACE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_auth_user"();

-- fotos da equipe: leitura pública, upload só por ADMIN
insert into storage.buckets (id, name, public)
values ('membros', 'membros', true)
on conflict (id) do update set public = true;

CREATE POLICY "membros_foto_escrita" ON "storage"."objects" TO "authenticated" USING ((("bucket_id" = 'membros'::"text") AND "public"."is_admin"())) WITH CHECK ((("bucket_id" = 'membros'::"text") AND "public"."is_admin"()));

CREATE POLICY "membros_foto_leitura" ON "storage"."objects" FOR SELECT TO "authenticated", "anon" USING (("bucket_id" = 'membros'::"text"));

-- ------------------------------------- funções que o browser não alcança
-- O dump só registra "REVOKE ... FROM PUBLIC", mas num projeto novo o
-- Supabase concede EXECUTE a anon/authenticated por default privileges.
-- Sem estas linhas, qualquer visitante chamaria mesclar_base direto com a
-- chave anon. Só a Edge Function import-planilha (service_role) as usa.
revoke execute on function public.mesclar_base(jsonb, jsonb, boolean, boolean, text, integer, text, uuid, text) from anon, authenticated;
revoke execute on function public.reverter_importacao(uuid, uuid) from anon, authenticated;
revoke execute on function public.sincronizar_obras_de_titulacao() from anon, authenticated;
