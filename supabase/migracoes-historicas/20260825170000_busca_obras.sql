-- =====================================================================
-- Busca de obras por texto da citacao.
--
-- A pagina de consulta so encontrava pessoas; esta funcao permite achar
-- obras por assunto ("coisa julgada", "tutela provisoria") e chegar dali
-- as autoras.
--
-- Busca sem acento e sem caixa: quem procura "execucao" tem de achar
-- "execução". Para isso ha um indice trigram sobre a expressao ja
-- normalizada, senao cada consulta varreria as ~6.800 citacoes.
-- =====================================================================

create extension if not exists pg_trgm;

-- unaccent(text) e' STABLE e nao pode entrar num indice; a forma de duas
-- vias, com o dicionario explicito, e' IMMUTABLE e pode.
create or replace function public.f_unaccent(text)
returns text
language sql
immutable
strict
parallel safe
as $$ select public.unaccent('public.unaccent'::regdictionary, $1) $$;

create index if not exists producoes_citacao_trgm_idx
  on public.producoes_bibliograficas
  using gin (public.f_unaccent(lower(citacao_completa)) gin_trgm_ops);

create index if not exists producoes_ano_idx
  on public.producoes_bibliograficas (ano_publicacao);

drop function if exists public.buscar_obras(text, text, text, text, integer, integer);

create or replace function public.buscar_obras(
  p_termo   text    default null,
  p_area    text    default null,
  p_tipo    text    default null,
  p_ano     text    default null,
  p_limite  integer default 20,
  p_offset  integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
$$;

grant execute on function public.buscar_obras(text, text, text, text, integer, integer) to anon, authenticated;
