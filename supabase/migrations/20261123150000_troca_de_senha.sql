-- =====================================================================
-- Troca de senha obrigatória no primeiro acesso.
--
-- As contas de pesquisador(a) nascem com uma senha padrão, a mesma para
-- todos. Quem teve a senha definida pela administradora (conta nova ou
-- senha redefinida) fica com `trocar_senha`: enquanto não trocar, o
-- portal só mostra a tela de troca, e o banco trata a pessoa como sem
-- papel nenhum, o que fecha tudo o que depende de get_my_role() e
-- is_admin(), inclusive para quem chamar a API direto.
--
-- A marca sai sozinha quando a senha muda de verdade (gatilho em
-- auth.users): não há como "tirar a marca" sem trocar a senha.
-- =====================================================================

alter table public.perfis
  add column if not exists trocar_senha boolean not null default false;

create or replace function public.get_my_role()
returns public.role_enum
language sql
stable
security definer
as $$
  select role from public.perfis where id = auth.uid() and not trocar_senha
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
as $$
  select exists (select 1 from public.perfis where id = auth.uid() and role = 'ADMIN' and not trocar_senha)
$$;

create or replace function public.senha_trocada()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.perfis set trocar_senha = false where id = new.id and trocar_senha;
  return new;
end;
$$;

revoke all on function public.senha_trocada() from public, anon, authenticated;

drop trigger if exists on_auth_user_password_changed on auth.users;
create trigger on_auth_user_password_changed
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.senha_trocada();
