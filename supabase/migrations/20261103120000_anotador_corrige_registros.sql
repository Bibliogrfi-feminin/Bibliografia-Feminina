-- =====================================================================
-- Anotadora corrige registros; excluir continua sendo só de ADMIN.
--
-- O UPDATE era só de ADMIN, mas a área da equipe (Dados → Registros)
-- oferece a edição a qualquer pessoa logada. Barrado pelo RLS, o UPDATE
-- não dá erro — só não acha linha —, então a anotadora salvava, a tela
-- fechava e nada mudava.
--
-- Em associadas, "excluir" é um UPDATE que preenche deletado_em. Por isso
-- a política da anotadora não alcança registros já excluídos e não deixa
-- preencher deletado_em: liberar o UPDATE não pode virar um jeito de
-- excluir chamando a API direto.
-- =====================================================================

drop policy if exists "assoc_update_admin" on public.associadas;
drop policy if exists "assoc_update_equipe" on public.associadas;
create policy "assoc_update_equipe" on public.associadas
  for update to authenticated
  using (
    public.is_admin()
    or (public.get_my_role() = 'ANOTADOR'::public.role_enum and deletado_em is null)
  )
  with check (
    public.is_admin()
    or (public.get_my_role() = 'ANOTADOR'::public.role_enum and deletado_em is null)
  );

drop policy if exists "prod_update_admin" on public.producoes_bibliograficas;
drop policy if exists "prod_update_equipe" on public.producoes_bibliograficas;
create policy "prod_update_equipe" on public.producoes_bibliograficas
  for update to authenticated
  using (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]))
  with check (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));

drop policy if exists "vinc_update_admin" on public.vinculos_docentes;
drop policy if exists "vinc_update_equipe" on public.vinculos_docentes;
create policy "vinc_update_equipe" on public.vinculos_docentes
  for update to authenticated
  using (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]))
  with check (public.get_my_role() = any (array['ADMIN'::public.role_enum, 'ANOTADOR'::public.role_enum]));
