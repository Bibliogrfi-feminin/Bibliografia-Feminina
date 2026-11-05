-- =====================================================================
-- Coleta Lattes: lotes de planilha preenchidos a partir do currículo.
--
-- A equipe sobe a planilha de mapeamento (ABA 1, uma mulher por linha);
-- cada linha com link do Lattes entra na fila. A anotadora abre o
-- currículo, resolve o captcha, e o userscript devolve a página ao
-- portal, que extrai titulações e obras e grava aqui. Depois de revisado,
-- o lote sai de novo como planilha (ABA 1 preenchida + ABA 2 com as
-- obras) para a classificação manual e a importação de sempre.
--
-- Fica tudo fora de `associadas` de propósito: as pessoas do lote ainda
-- não fazem parte da base pública, e as obras não têm os campos que
-- `producoes_bibliograficas` exige (tipo, área, formato), que o grupo
-- classifica à mão.
-- =====================================================================

create table if not exists public.coleta_lotes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  arquivo text,
  -- cabeçalho da ABA 1 na ordem original, para a planilha sair igual
  colunas text[] not null,
  -- cabeçalho da ABA 2 (produção bibliográfica), idem
  colunas_obras text[] not null,
  criado_por uuid references auth.users(id) on delete set null default auth.uid(),
  criado_em timestamptz not null default now()
);

create table if not exists public.coleta_itens (
  id uuid primary key default gen_random_uuid(),
  lote_id uuid not null references public.coleta_lotes(id) on delete cascade,
  -- linha na planilha original (2 = primeira linha de dados)
  linha integer not null,
  nome text not null,
  lattes_id text,
  link text,
  -- a linha inteira como veio, {cabeçalho: valor}
  original jsonb not null default '{}'::jsonb,
  status text not null default 'PENDENTE'
    check (status in ('SEM_LATTES', 'PENDENTE', 'COLETADO', 'REVISADO', 'ERRO')),
  -- o que saiu do currículo (CurriculoLattes de src/lib/lattes.ts)
  coletado jsonb,
  coletado_por uuid references auth.users(id) on delete set null,
  coletado_em timestamptz,
  -- o que a revisão aprovou: {campos: {cabeçalho: valor}, obras: [...]}
  revisao jsonb,
  revisado_por uuid references auth.users(id) on delete set null,
  revisado_em timestamptz,
  erro text,
  -- reserva da fila, para duas anotadoras não abrirem o mesmo currículo
  reservado_por uuid references auth.users(id) on delete set null,
  reservado_em timestamptz,
  unique (lote_id, linha)
);

create index if not exists coleta_itens_lote_status on public.coleta_itens (lote_id, status);

alter table public.coleta_lotes enable row level security;
alter table public.coleta_itens enable row level security;

-- equipe = ADMIN ou ANOTADOR; só ADMIN apaga lote
drop policy if exists "coleta_lotes_equipe" on public.coleta_lotes;
create policy "coleta_lotes_equipe" on public.coleta_lotes
  for select to authenticated
  using (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));

drop policy if exists "coleta_lotes_insert" on public.coleta_lotes;
create policy "coleta_lotes_insert" on public.coleta_lotes
  for insert to authenticated
  with check (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));

drop policy if exists "coleta_lotes_delete" on public.coleta_lotes;
create policy "coleta_lotes_delete" on public.coleta_lotes
  for delete to authenticated
  using (public.is_admin());

drop policy if exists "coleta_itens_equipe" on public.coleta_itens;
create policy "coleta_itens_equipe" on public.coleta_itens
  for select to authenticated
  using (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));

drop policy if exists "coleta_itens_insert" on public.coleta_itens;
create policy "coleta_itens_insert" on public.coleta_itens
  for insert to authenticated
  with check (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));

drop policy if exists "coleta_itens_update" on public.coleta_itens;
create policy "coleta_itens_update" on public.coleta_itens
  for update to authenticated
  using (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]))
  with check (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));

-- ---------------------------------------------------------------------
-- Próximo currículo da fila, já reservado para quem pediu.
--
-- SKIP LOCKED faz duas anotadoras que clicam ao mesmo tempo receberem
-- linhas diferentes. A reserva vence em 15 minutos: quem fechou a aba no
-- meio não prende a linha para sempre. `pular` é a linha que a pessoa
-- acabou de deixar para depois, para não recebê-la de volta na hora.
-- ---------------------------------------------------------------------
create or replace function public.coleta_proximo(p_lote uuid, p_pular uuid default null)
returns public.coleta_itens
language plpgsql
security invoker
set search_path = public
as $$
declare
  item public.coleta_itens;
begin
  if public.get_my_role() is null then
    raise exception 'sem permissão';
  end if;

  -- devolve à fila o que a própria pessoa tinha reservado
  update public.coleta_itens
     set reservado_por = null, reservado_em = null
   where lote_id = p_lote and reservado_por = auth.uid() and status = 'PENDENTE';

  select * into item
    from public.coleta_itens
   where lote_id = p_lote
     and status in ('PENDENTE', 'ERRO')
     and (p_pular is null or id <> p_pular)
     and (reservado_em is null or reservado_em < now() - interval '15 minutes')
   order by (status = 'ERRO'), linha
   limit 1
   for update skip locked;

  if not found then
    return null;
  end if;

  update public.coleta_itens
     set reservado_por = auth.uid(), reservado_em = now()
   where id = item.id
  returning * into item;

  return item;
end;
$$;

grant execute on function public.coleta_proximo(uuid, uuid) to authenticated;
