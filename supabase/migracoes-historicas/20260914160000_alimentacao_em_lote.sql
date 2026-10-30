-- =====================================================================
-- Alimentacao em lote.
--
-- Substitui a antiga "substituicao integral" por uma regra que a pessoa
-- que usa consegue guardar de cabeca:
--
--   A planilha manda nas pessoas que ela contem, e e' silenciosa sobre
--   as demais.
--
-- Na pratica:
--   - quem esta na aba 1 tem o cadastro reescrito pelo que a planilha diz;
--   - quem esta na aba 2 tem a bibliografia reescrita pelo que a aba 2 diz;
--   - quem NAO aparece na planilha nao e' tocado -- a nao ser que a admin
--     marque `p_remover_ausentes`, e ai' o comportamento antigo volta.
--
-- Escopo, e nao dedup, e' o que impede duplicata: nao comparamos citacao
-- por citacao (que erra em pontuacao e acento), apagamos a bibliografia
-- das pessoas presentes na aba 2 antes de reinserir a delas.
--
-- Uma pessoa que esta na aba 1 mas nao na aba 2 MANTEM a bibliografia que
-- ja tinha. Sem isso, subir uma planilha so' com a aba 1 -- para corrigir
-- um e-mail, digamos -- apagaria a producao de todo mundo.
-- =====================================================================

-- --------------------------------------------------------------------
-- 1. Remove o importador antigo.
--
-- Era SECURITY DEFINER com EXECUTE concedido a anon, e a chave anon vai
-- no bundle publico do site: qualquer pessoa na internet conseguia
-- inserir registros na base chamando a funcao direto. A tela que a usava
-- (BatchImportTab) saiu junto.
-- --------------------------------------------------------------------
drop function if exists public.bulk_import_processualistas(jsonb, boolean);

-- --------------------------------------------------------------------
-- 2. Obras derivadas da titulacao
--
-- Mestrado, doutorado e livre-docencia sao colunas da aba 1, e viram
-- obras para poderem ser encontradas na busca. Como sao DERIVADAS, toda
-- importacao as recria no final -- senao a etapa anterior, que apaga e
-- reinsere a bibliografia, levaria as 581 junto.
-- --------------------------------------------------------------------
create or replace function public.sincronizar_obras_de_titulacao()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $fn$
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
$fn$;

revoke execute on function public.sincronizar_obras_de_titulacao() from public, anon, authenticated;

-- --------------------------------------------------------------------
-- 3. A importacao em si
-- --------------------------------------------------------------------
create or replace function public.mesclar_base(
  p_associadas       jsonb,
  p_producoes        jsonb,
  p_dry_run          boolean default true,
  p_remover_ausentes boolean default false,
  p_arquivo_nome     text    default null,
  p_arquivo_tamanho  integer default 0,
  p_arquivo_hash     text    default null,
  p_usuario_id       uuid    default null,
  p_usuario_nome     text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
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
$fn$;

revoke execute on function
  public.mesclar_base(jsonb, jsonb, boolean, boolean, text, integer, text, uuid, text)
  from public, anon, authenticated;

-- --------------------------------------------------------------------
-- 4. A substituicao integral virou um caso particular da mesclagem
--    (p_remover_ausentes = true), entao a funcao antiga sai: duas portas
--    de escrita para a mesma coisa e' uma superficie a mais para manter.
-- --------------------------------------------------------------------
drop function if exists public.substituir_base_completa(jsonb, jsonb, boolean, text, integer, text, uuid, text);
