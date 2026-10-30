-- =====================================================================
-- Conteudo editavel das paginas institucionais + equipe do projeto.
--
-- Home, Sobre, Metodologia e Quem Somos deixam de ter texto cravado no
-- codigo: passam a ler daqui, e uma administradora edita pelo painel sem
-- precisar de deploy.
--
-- Leitura e' publica (o site e' aberto); escrita, so ADMIN, via RLS.
-- =====================================================================

-- ------------------------------------------------------------ paginas
create table if not exists public.paginas (
  slug            text primary key,
  titulo          text not null,
  subtitulo       text,
  conteudo        text not null default '',   -- markdown
  ordem           integer not null default 0,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid references auth.users(id) on delete set null
);

comment on column public.paginas.conteudo is
  'Markdown: ## titulo, ### subtitulo, **negrito**, *italico*, listas com -, [link](url)';

alter table public.paginas enable row level security;

drop policy if exists paginas_leitura_publica on public.paginas;
create policy paginas_leitura_publica on public.paginas
  for select to anon, authenticated using (true);

drop policy if exists paginas_escrita_admin on public.paginas;
create policy paginas_escrita_admin on public.paginas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ------------------------------------------------------------ membros
create table if not exists public.membros (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  funcao       text,                       -- ex: "Professora, FD-USP"
  grupo        text not null default 'Integrantes',
  bio          text,
  foto_url     text,                       -- caminho no bucket ou URL completa
  lattes_url   text,
  ordem        integer not null default 0,
  criado_em    timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists membros_grupo_ordem_idx on public.membros (grupo, ordem, nome);

alter table public.membros enable row level security;

drop policy if exists membros_leitura_publica on public.membros;
create policy membros_leitura_publica on public.membros
  for select to anon, authenticated using (true);

drop policy if exists membros_escrita_admin on public.membros;
create policy membros_escrita_admin on public.membros
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ordem em que os grupos aparecem na pagina Quem Somos
create table if not exists public.grupos_membros (
  nome   text primary key,
  ordem  integer not null default 0
);

alter table public.grupos_membros enable row level security;

drop policy if exists grupos_leitura_publica on public.grupos_membros;
create policy grupos_leitura_publica on public.grupos_membros
  for select to anon, authenticated using (true);

drop policy if exists grupos_escrita_admin on public.grupos_membros;
create policy grupos_escrita_admin on public.grupos_membros
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.grupos_membros (nome, ordem) values
  ('Coordenação', 1), ('Organização', 2), ('Apoio Tecnológico', 3), ('Integrantes', 4)
on conflict (nome) do nothing;

-- ---------------------------------------------------- atualizado_em
create or replace function public.touch_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists paginas_touch on public.paginas;
create trigger paginas_touch before update on public.paginas
  for each row execute function public.touch_atualizado_em();

drop trigger if exists membros_touch on public.membros;
create trigger membros_touch before update on public.membros
  for each row execute function public.touch_atualizado_em();

-- --------------------------------------------------- storage de fotos
-- Bucket publico: as fotos aparecem no site aberto. Upload so por ADMIN.
insert into storage.buckets (id, name, public)
values ('membros', 'membros', true)
on conflict (id) do update set public = true;

drop policy if exists membros_foto_leitura on storage.objects;
create policy membros_foto_leitura on storage.objects
  for select to anon, authenticated using (bucket_id = 'membros');

drop policy if exists membros_foto_escrita on storage.objects;
create policy membros_foto_escrita on storage.objects
  for all to authenticated
  using (bucket_id = 'membros' and public.is_admin())
  with check (bucket_id = 'membros' and public.is_admin());

-- ------------------------------------------------ numeros vivos da home
-- A Home mostra o que a base realmente tem, e nao os numeros do
-- levantamento original (481 mapeadas / 6.824 obras), que sao um relato
-- historico e seguem preservados no texto da Metodologia.
create or replace function public.get_numeros_home()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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

grant execute on function public.get_numeros_home() to anon, authenticated;
