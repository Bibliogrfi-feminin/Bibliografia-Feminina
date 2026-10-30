-- =====================================================================
-- Importacao de planilha pelo painel de administracao.
--
-- Substituir a base inteira e' uma operacao destrutiva. As protecoes aqui
-- sao, em ordem de importancia:
--   1. snapshot integral do estado anterior, na MESMA transacao da troca,
--      permitindo reverter com um clique;
--   2. dry-run obrigatorio na UI antes de aplicar;
--   3. recusa de planilha vazia / volume absurdo / nomes colidentes;
--   4. EXECUTE revogado de anon e authenticated (so a Edge Function,
--      que valida o JWT de ADMIN, alcanca a funcao via service_role);
--   5. trilha em audit_logs e historico em importacoes.
-- =====================================================================

create extension if not exists unaccent;

-- ---------------------------------------------------------------- chave
-- Normaliza nome para casar pessoas entre planilha e banco:
-- sem acento, minusculo, so letras e espaco simples.
create or replace function public.nome_key(p text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select trim(regexp_replace(
           regexp_replace(lower(unaccent(coalesce(p, ''))), '[^a-z ]', ' ', 'g'),
           '\s+', ' ', 'g'))
$$;

-- ----------------------------------------------------------- historico
create table if not exists public.importacoes (
  id               uuid primary key default gen_random_uuid(),
  usuario_id       uuid references auth.users(id) on delete set null,
  usuario_nome     text,
  arquivo_nome     text not null,
  arquivo_tamanho  integer not null,
  arquivo_hash     text,
  status           text not null default 'APLICADA'
                     check (status in ('APLICADA', 'REVERTIDA', 'ERRO')),
  relatorio        jsonb,
  snapshot         jsonb,
  revertida_em     timestamptz,
  revertida_por    uuid references auth.users(id) on delete set null,
  criado_em        timestamptz not null default now()
);

create index if not exists importacoes_criado_em_idx on public.importacoes (criado_em desc);

alter table public.importacoes enable row level security;

-- historico e' visivel so para admin; escrita so via service_role
drop policy if exists importacoes_select_admin on public.importacoes;
create policy importacoes_select_admin on public.importacoes
  for select to authenticated
  using (public.is_admin());

-- ------------------------------------------------- substituicao da base
-- Remove a assinatura de 3 argumentos usada na carga inicial, para nao
-- deixar uma sobrecarga ambigua (e uma superficie a mais) no banco.
drop function if exists public.substituir_base_completa(jsonb, jsonb, boolean);

create or replace function public.substituir_base_completa(
  p_associadas     jsonb,
  p_producoes      jsonb,
  p_dry_run        boolean default true,
  p_arquivo_nome   text    default null,
  p_arquivo_tamanho integer default 0,
  p_arquivo_hash   text    default null,
  p_usuario_id     uuid    default null,
  p_usuario_nome   text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_antes_assoc int;  v_antes_prod int;  v_antes_vinc int;
  v_in_assoc int;     v_in_prod int;
  v_match int;        v_novas int;       v_remover int;
  v_upd int := 0;     v_ins int := 0;    v_del int := 0;
  v_vinc int := 0;    v_prod int := 0;   v_prod_orfa int := 0;
  v_removidas jsonb;
  v_snapshot  jsonb;
  v_import_id uuid;
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
    raise exception 'Recusado: a planilha nao contem nenhuma processualista. Aplicar isso apagaria a base inteira.';
  end if;
  if v_in_assoc > 20000 or v_in_prod > 200000 then
    raise exception 'Recusado: volume acima do limite (% processualistas, % producoes).', v_in_assoc, v_in_prod;
  end if;

  select count(*) into v_antes_assoc from associadas where deletado_em is null;
  select count(*) into v_antes_prod  from producoes_bibliograficas;
  select count(*) into v_antes_vinc  from vinculos_docentes;

  -- guarda-corpo: recusa planilha que encolhe a base em mais de 50%,
  -- salvo confirmacao explicita (arquivo_hash prefixado com 'FORCE:')
  if v_antes_assoc > 0
     and v_in_assoc < v_antes_assoc * 0.5
     and coalesce(p_arquivo_hash, '') not like 'FORCE:%' then
    raise exception 'Recusado: a planilha tem % processualistas contra % na base (queda de mais de 50%%). Confirme explicitamente para prosseguir.',
      v_in_assoc, v_antes_assoc;
  end if;

  -- ---------- staging ----------
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

  select count(*) into v_match     from _cur c join _in_assoc i on i.k = c.k;
  select count(*) into v_novas     from _in_assoc i left join _cur c on c.k = i.k where c.id is null;
  select count(*) into v_remover   from _cur c left join _in_assoc i on i.k = c.k where i.k is null;
  select count(*) into v_prod_orfa from _in_prod p left join _in_assoc i on i.k = p.k where i.k is null;

  select coalesce(jsonb_agg(jsonb_build_object('nome', c.nome, 'id', c.id) order by c.nome), '[]'::jsonb)
    into v_removidas
  from _cur c left join _in_assoc i on i.k = c.k where i.k is null;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'antes',   jsonb_build_object('associadas', v_antes_assoc, 'producoes', v_antes_prod, 'vinculos', v_antes_vinc),
      'plano',   jsonb_build_object('atualizadas', v_match, 'inseridas', v_novas,
                                    'removidas', v_remover, 'producoes_sem_dona', v_prod_orfa),
      'depois',  jsonb_build_object('associadas', v_match + v_novas, 'producoes', v_in_prod - v_prod_orfa),
      'lista_removidas', v_removidas
    );
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

  -- ---------- escrita ----------
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

  delete from associadas a using _cur c
  where a.id = c.id and not exists (select 1 from _in_assoc i where i.k = c.k);
  get diagnostics v_del = row_count;

  with novas as (
    select i.doc d from _in_assoc i left join _cur c on c.k = i.k where c.id is null
  )
  insert into associadas (
    nome, email, status_registro, uf_atuacao, atuacao_profissional,
    ibdp, abep, leciona, link_lattes, data_atualizacao_lattes,
    especialista, mestre, titulo_mestrado, ano_mestrado, faculdade_mestrado, area_mestrado, link_mestrado,
    doutora, titulo_doutorado, ano_doutorado, faculdade_doutorado, area_doutorado, link_doutorado,
    livre_docente, titulo_livre_docencia, ano_livre_docencia, faculdade_livre_docencia, area_livre_docencia, link_livre_docencia
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
    nullif(d->>'faculdade_livre_docencia',''), nullif(d->>'area_livre_docencia',''), nullif(d->>'link_livre_docencia','')
  from novas;
  get diagnostics v_ins = row_count;

  create temp table _map on commit drop as
  select id, nome_key(nome) as k from associadas where deletado_em is null;

  -- vinculos e producoes sao substituidos integralmente
  delete from vinculos_docentes where true;   -- WHERE exigido pelo safeupdate
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

  delete from producoes_bibliograficas where true;
  insert into producoes_bibliograficas (associada_id, tipo_obra, citacao_completa, ano_publicacao, area_processo, formato)
  select m.id,
         (p.doc->>'tipo_obra')::tipo_obra_enum,
         p.doc->>'citacao_completa',
         p.doc->>'ano_publicacao',
         (p.doc->>'area_processo')::area_processo_enum,
         coalesce((p.doc->>'formato')::formato_enum,'ELETRONICA')
  from _in_prod p join _map m on m.k = p.k
  where nullif(p.doc->>'citacao_completa','') is not null;
  get diagnostics v_prod = row_count;

  -- ---------- historico + auditoria ----------
  insert into importacoes (usuario_id, usuario_nome, arquivo_nome, arquivo_tamanho, arquivo_hash, status, relatorio, snapshot)
  values (
    p_usuario_id, p_usuario_nome,
    coalesce(p_arquivo_nome, 'planilha.xlsx'), coalesce(p_arquivo_tamanho, 0), p_arquivo_hash,
    'APLICADA',
    jsonb_build_object(
      'antes',  jsonb_build_object('associadas',v_antes_assoc,'producoes',v_antes_prod,'vinculos',v_antes_vinc),
      'depois', jsonb_build_object('associadas',v_upd+v_ins,'producoes',v_prod,'vinculos',v_vinc),
      'atualizadas',v_upd,'inseridas',v_ins,'removidas',v_del,
      'lista_removidas', v_removidas),
    v_snapshot
  )
  returning id into v_import_id;

  if p_usuario_id is not null then
    insert into audit_logs (acao, entidade, entidade_id, detalhes, usuario_id)
    values ('UPDATE','BASE_COMPLETA', v_import_id,
            jsonb_build_object('origem','planilha','arquivo',p_arquivo_nome,
                               'atualizadas',v_upd,'inseridas',v_ins,'removidas',v_del,
                               'producoes',v_prod,'vinculos',v_vinc),
            p_usuario_id);
  end if;

  -- mantem so os 5 snapshots mais recentes (cada um pesa alguns MB)
  update importacoes set snapshot = null
  where snapshot is not null
    and id not in (select id from importacoes where snapshot is not null order by criado_em desc limit 5);

  return jsonb_build_object(
    'dry_run', false,
    'importacao_id', v_import_id,
    'antes',  jsonb_build_object('associadas', v_antes_assoc, 'producoes', v_antes_prod, 'vinculos', v_antes_vinc),
    'depois', jsonb_build_object('associadas', v_upd + v_ins, 'producoes', v_prod, 'vinculos', v_vinc),
    'atualizadas', v_upd, 'inseridas', v_ins, 'removidas', v_del,
    'producoes_sem_dona', v_prod_orfa,
    'lista_removidas', v_removidas
  );
end;
$$;

-- ------------------------------------------------------------ rollback
create or replace function public.reverter_importacao(p_id uuid, p_usuario_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
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

-- ---------------------------------------------------------- permissoes
-- Estas funcoes nunca devem ser alcancaveis pelo browser diretamente.
-- Quem chama e' a Edge Function `import-planilha`, com service_role,
-- depois de validar que o JWT pertence a um ADMIN.
revoke all on function public.substituir_base_completa(jsonb, jsonb, boolean, text, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.substituir_base_completa(jsonb, jsonb, boolean, text, integer, text, uuid, text) to service_role;

revoke all on function public.reverter_importacao(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reverter_importacao(uuid, uuid) to service_role;
