-- =====================================================================
-- 1. Só titulação de direito processual vira obra no portal.
-- 2. Papel PESQUISADOR, com poderes reduzidos.
-- 3. Revisão de pesquisador(a) espera a conferência da equipe.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Obras de titulação: só direito processual
--
-- O portal é de direito processual: dissertação ou tese defendida em
-- outra área (Direito Civil, Penal, Filosofia e TGD...) não entra como
-- obra. A que ainda não tem área classificada também fica de fora até o
-- grupo classificar. A titulação continua na ficha da pessoa.
-- ---------------------------------------------------------------------

create or replace function public.e_processual(p text)
returns boolean
language sql
immutable
as $$
  select coalesce(lower(btrim(p)) like 'direito processual%', false)
$$;

grant execute on function public.e_processual(text) to anon, authenticated;

create or replace function public.sincronizar_obras_de_titulacao()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
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
  ) t
  where e_processual(t.area);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.sincronizar_obras_de_titulacao() from public, anon, authenticated;

create or replace function public.sincronizar_titulacao_de(p_associada uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_n int;
begin
  -- apaga e refaz obras: só a equipe (pesquisador(a) não grava na ficha)
  if public.get_my_role() is null or public.get_my_role() not in ('ADMIN', 'ANOTADOR') then
    raise exception 'sem permissão';
  end if;

  delete from producoes_bibliograficas
  where associada_id = p_associada
    and tipo_obra in ('Dissertação de Mestrado', 'Tese de Doutorado', 'Tese de Livre-Docência');

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
    from associadas where id = p_associada and deletado_em is null and mestre and titulo_mestrado is not null
    union all
    select id, nome, 'Tese de Doutorado', 'Tese (Doutorado)',
           titulo_doutorado, ano_doutorado, faculdade_doutorado, area_doutorado, link_doutorado
    from associadas where id = p_associada and deletado_em is null and doutora and titulo_doutorado is not null
    union all
    select id, nome, 'Tese de Livre-Docência', 'Tese (Livre-Docência)',
           titulo_livre_docencia, ano_livre_docencia, faculdade_livre_docencia,
           area_livre_docencia, link_livre_docencia
    from associadas where id = p_associada and deletado_em is null and livre_docente and titulo_livre_docencia is not null
  ) t
  where e_processual(t.area);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.sincronizar_titulacao_de(uuid) from public, anon;
grant execute on function public.sincronizar_titulacao_de(uuid) to authenticated;

-- As que já existem: sai a obra de titulação cuja área não é processual
-- (ou está vazia). Nada se perde: a titulação continua na ficha, e a obra
-- volta sozinha quando a área for classificada como processual.
delete from public.producoes_bibliograficas p
 using public.associadas a
 where p.associada_id = a.id
   and (
        (p.tipo_obra = 'Dissertação de Mestrado' and not public.e_processual(a.area_mestrado))
     or (p.tipo_obra = 'Tese de Doutorado'       and not public.e_processual(a.area_doutorado))
     or (p.tipo_obra = 'Tese de Livre-Docência'  and not public.e_processual(a.area_livre_docencia))
   );


-- ---------------------------------------------------------------------
-- 2. O que PESQUISADOR alcança
--
-- Lê a base e a coleta; cadastra pessoa nova (com vínculos e obras);
-- coleta currículos nos lotes que já existem e envia revisões para a
-- conferência. NÃO edita fichas nem obras existentes, NÃO exclui nada,
-- NÃO cria nem apaga lote, NÃO mexe na tabela de siglas.
-- ---------------------------------------------------------------------

drop policy if exists "assoc_insert_anotador" on public.associadas;
create policy "assoc_insert_anotador" on public.associadas
  for insert to authenticated
  with check (
    public.get_my_role() in ('ADMIN', 'ANOTADOR')
    or (public.get_my_role() = 'PESQUISADOR' and deletado_em is null)
  );

drop policy if exists "prod_insert_anotador" on public.producoes_bibliograficas;
create policy "prod_insert_anotador" on public.producoes_bibliograficas
  for insert to authenticated
  with check (public.get_my_role() in ('ADMIN', 'ANOTADOR', 'PESQUISADOR'));

drop policy if exists "vinc_insert_anotador" on public.vinculos_docentes;
create policy "vinc_insert_anotador" on public.vinculos_docentes
  for insert to authenticated
  with check (public.get_my_role() in ('ADMIN', 'ANOTADOR', 'PESQUISADOR'));

drop policy if exists "regdin_insert_anotador" on public.registros_dinamicos;
create policy "regdin_insert_anotador" on public.registros_dinamicos
  for insert to authenticated
  with check (public.get_my_role() in ('ADMIN', 'ANOTADOR', 'PESQUISADOR'));

drop policy if exists "coleta_lotes_equipe" on public.coleta_lotes;
create policy "coleta_lotes_equipe" on public.coleta_lotes
  for select to authenticated
  using (public.get_my_role() in ('ADMIN', 'ANOTADOR', 'PESQUISADOR'));

drop policy if exists "coleta_itens_equipe" on public.coleta_itens;
create policy "coleta_itens_equipe" on public.coleta_itens
  for select to authenticated
  using (public.get_my_role() in ('ADMIN', 'ANOTADOR', 'PESQUISADOR'));

drop policy if exists "coleta_itens_update" on public.coleta_itens;
create policy "coleta_itens_update" on public.coleta_itens
  for update to authenticated
  using (public.get_my_role() in ('ADMIN', 'ANOTADOR', 'PESQUISADOR'))
  with check (public.get_my_role() in ('ADMIN', 'ANOTADOR', 'PESQUISADOR'));

-- siglas: a equipe mantém; pesquisador(a) só lê (a revisão usa a tabela)
drop policy if exists "coleta_siglas_leitura" on public.coleta_siglas;
create policy "coleta_siglas_leitura" on public.coleta_siglas
  for select to authenticated
  using (public.get_my_role() = 'PESQUISADOR');


-- ---------------------------------------------------------------------
-- 3. Revisão de pesquisador(a) → conferência da equipe
--
-- A revisão enviada fica AGUARDANDO; a anotadora ou admin abre, confere e
-- grava (aí vira REVISADO). O gatilho abaixo é a trava de verdade: vale
-- também para quem chamar a API direto, sem passar pela tela.
-- ---------------------------------------------------------------------

alter table public.coleta_itens drop constraint if exists coleta_itens_status_check;
alter table public.coleta_itens add constraint coleta_itens_status_check
  check (status in ('SEM_LATTES', 'PENDENTE', 'COLETADO', 'AGUARDANDO', 'REVISADO', 'ERRO'));

alter table public.coleta_itens
  add column if not exists proposto_por uuid references auth.users(id) on delete set null,
  add column if not exists proposto_em timestamptz;

create or replace function public.coleta_itens_guarda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campo text;
  v_valor text;
  v_antes text;
begin
  if public.get_my_role() is distinct from 'PESQUISADOR' then
    return new;
  end if;

  -- o que a equipe já conferiu não volta atrás pelas mãos de pesquisador(a)
  if old.status = 'REVISADO' then
    raise exception 'Este currículo já foi conferido pela equipe; só anotadora ou admin pode mudar.';
  end if;
  -- uma revisão enviada não se perde numa nova coleta
  if old.status = 'AGUARDANDO' and new.status <> 'AGUARDANDO' then
    raise exception 'Este currículo está esperando a conferência da equipe.';
  end if;
  if new.status = 'REVISADO' then
    raise exception 'A revisão de pesquisador(a) vai para a conferência da equipe.';
  end if;

  -- a linha da planilha e o vínculo com a ficha são fixos
  if (new.lote_id, new.linha, new.nome, new.lattes_id, new.link, new.original, new.associada_id)
     is distinct from
     (old.lote_id, old.linha, old.nome, old.lattes_id, old.link, old.original, old.associada_id) then
    raise exception 'Pesquisador(a) não altera os dados da linha do lote.';
  end if;
  if (new.revisado_por, new.revisado_em) is distinct from (old.revisado_por, old.revisado_em) then
    raise exception 'Só a equipe marca um currículo como conferido.';
  end if;

  if new.status = 'AGUARDANDO' then
    -- pode corrigir, não pode esvaziar o que já estava preenchido
    for v_campo, v_valor in select key, value from jsonb_each_text(coalesce(new.revisao->'campos', '{}'::jsonb)) loop
      v_antes := btrim(coalesce(old.original->>v_campo, ''));
      if v_antes not in ('', 'N/A') and btrim(coalesce(v_valor, '')) in ('', 'N/A') then
        raise exception 'Pesquisador(a) não pode deixar em branco "%", que já estava preenchido.', v_campo;
      end if;
    end loop;
    new.proposto_por := auth.uid();
    new.proposto_em := now();
  end if;

  return new;
end;
$$;

drop trigger if exists coleta_itens_guarda on public.coleta_itens;
create trigger coleta_itens_guarda
  before update on public.coleta_itens
  for each row execute function public.coleta_itens_guarda();
