-- =====================================================================
-- Coleta Lattes de quem já está na base.
--
-- O lote deixa de vir só de planilha: pode nascer das associadas do
-- próprio portal. Aí a revisão aprovada grava direto em `associadas`
-- (titulações e data de atualização), e as obras novas continuam saindo
-- em planilha para a classificação manual.
-- =====================================================================

alter table public.coleta_lotes
  add column if not exists origem text not null default 'PLANILHA'
    check (origem in ('PLANILHA', 'BASE'));

alter table public.coleta_itens
  add column if not exists associada_id uuid references public.associadas(id) on delete set null;

create index if not exists coleta_itens_associada on public.coleta_itens (associada_id);

-- ---------------------------------------------------------------------
-- Dissertação e teses de UMA pessoa, refeitas a partir da titulação.
--
-- Mesma regra de sincronizar_obras_de_titulacao(), que a importação por
-- planilha roda para a base inteira; aqui só para quem a coleta acabou
-- de atualizar. Sem isso, a ficha mostraria a titulação nova e a obra
-- derivada antiga.
-- ---------------------------------------------------------------------
create or replace function public.sincronizar_titulacao_de(p_associada uuid)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_n int;
begin
  if public.get_my_role() is null then
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
  ) t;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.sincronizar_titulacao_de(uuid) from public, anon;
grant execute on function public.sincronizar_titulacao_de(uuid) to authenticated;
