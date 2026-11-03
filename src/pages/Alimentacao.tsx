import { useState, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { supabase } from "../lib/supabase";
import { Plus, Trash2 } from "lucide-react";
import { ProducaoForm } from "../components/ProducaoForm";

/**
 * Cadastro de uma processualista (aba 1) ou de uma obra (aba 2) por vez.
 *
 * É uma das abas de Dados. A importação por planilha, que antes morava
 * aqui numa terceira aba, saiu: lia o Excel no navegador com a lib xlsx do npm
 * e escrevia direto nas tabelas sem conferir duplicata.
 */
export const CadastroIndividual = () => {
  const [tab, setTab] = useState<"MANUAL" | "PRODUCAO">("MANUAL");
  const [camposExtras, setCamposExtras] = useState<any[]>([]);

  useEffect(() => {
    supabase.from("definicoes_campos_extras").select("*").eq("entidade", "Associada").order("label")
      .then(({ data }) => setCamposExtras(data || []));
  }, []);

  const { register, handleSubmit, reset, watch, control, formState: { isSubmitting } } = useForm<any>({
    defaultValues: {
      ibdp: false, abep: false,
      leciona: false,
      vinculos_docentes: [],
      especialista: false, mestre: false, doutora: false, livre_docente: false
    }
  });

  const { fields, append, remove } = useFieldArray({ control, name: "vinculos_docentes" });

  const leciona = watch("leciona");
  const is_mestre = watch("mestre");
  const is_doutora = watch("doutora");
  const is_livre_docente = watch("livre_docente");

  const onSubmitManual = async (formData: any) => {
    try {
      const vinculos = formData.vinculos_docentes || [];
      delete formData.vinculos_docentes;

      const dadosExtras: any = {};
      camposExtras.forEach(c => {
        if (formData[c.nome_campo] !== undefined) {
          dadosExtras[c.nome_campo] = formData[c.nome_campo];
          delete formData[c.nome_campo];
        }
      });
      if (Object.keys(dadosExtras).length > 0) {
        formData.dados_extras = dadosExtras;
      }

      if (!formData.email) delete formData.email;

      const { data: inserted, error } = await supabase.from("associadas").insert(formData).select("id").single();
      if (error) throw error;

      if (vinculos.length > 0) {
        const { error: erroVinculos } = await supabase.from("vinculos_docentes").insert(
          vinculos.map((v: any) => ({ ...v, associada_id: inserted.id }))
        );
        // a processualista já foi gravada: avisar que só os vínculos ficaram de fora
        if (erroVinculos) throw new Error(`a processualista foi salva, mas os vínculos não (${erroVinculos.message})`);
      }

      alert("Processualista salva com sucesso!");
      reset();
    } catch (err: any) {
      alert("Erro ao salvar registro: " + (err.message || ""));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex space-x-1 border-b border-[var(--border)] overflow-x-auto whitespace-nowrap">
        {(["MANUAL", "PRODUCAO"] as const).map((t, i) => (
          <button key={t} onClick={() => setTab(t)} className={`px-5 py-3 font-medium text-sm transition-colors ${tab === t ? "border-b-2 border-[var(--accent)] text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--text-main)]"}`}>
            {["Aba 1 — Processualista", "Aba 2 — Produção bibliográfica"][i]}
          </button>
        ))}
      </div>

      {tab === "MANUAL" && (
        <div className="bg-white p-8 rounded-xl border border-[var(--border)] shadow-sm">
          <form className="space-y-8">

            <section>
              <h3 className="font-serif italic text-lg text-[var(--text-main)] mb-4 border-b pb-2">Dados Pessoais e Atuação Profissional</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Nome Completo *</label><input required pattern=".*\S.*" title="Não pode ficar em branco" {...register("nome")} className="w-full px-3 py-2 border rounded-lg focus:ring-1 focus:ring-[var(--accent)] outline-none" /></div>
                <div><label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Email *</label><input type="email" required {...register("email")} className="w-full px-3 py-2 border rounded-lg focus:ring-1 focus:ring-[var(--accent)] outline-none" /></div>
                <div><label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Qual a atuação profissional? *</label><input required pattern=".*\S.*" title="Não pode ficar em branco" {...register("atuacao_profissional")} className="w-full px-3 py-2 border rounded-lg focus:ring-1 focus:ring-[var(--accent)] outline-none" /></div>
                <div><label className="block text-xs font-bold text-[var(--text-muted)] mb-1">UF da atuação principal</label><input {...register("uf_atuacao")} maxLength={2} className="w-full px-3 py-2 border rounded-lg focus:ring-1 focus:ring-[var(--accent)] outline-none" /></div>
              </div>
            </section>

            <section>
              <h3 className="font-serif italic text-lg text-[var(--text-main)] mb-4 border-b pb-2">Entidades e Lattes</h3>
              <div className="flex gap-4 mb-4">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("ibdp")} /> É associada do IBDP?</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" {...register("abep")} /> É associada da ABEP?</label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Link do currículo Lattes *</label><input required pattern=".*\S.*" title="Não pode ficar em branco" {...register("link_lattes")} className="w-full px-3 py-2 border rounded-lg focus:ring-1 focus:ring-[var(--accent)] outline-none" /></div>
                <div><label className="block text-xs font-bold text-[var(--text-muted)] mb-1">Data da última atualização do Lattes</label><input {...register("data_atualizacao_lattes")} type="date" className="w-full px-3 py-2 border rounded-lg focus:ring-1 focus:ring-[var(--accent)] outline-none" /></div>
              </div>
            </section>

            <section>
              <h3 className="font-serif italic text-lg text-[var(--text-main)] mb-4 border-b pb-2">Atuação Docente</h3>
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-semibold p-3 bg-[var(--row-hover)] rounded-lg cursor-pointer">
                  <input type="checkbox" {...register("leciona")} />
                  Leciona? (Vínculo com instituição de ensino)
                </label>
                {leciona && (
                  <div className="space-y-4 pl-6 border-l-2 border-[var(--border)] mt-4 animate-in slide-in-from-left-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase text-[var(--text-muted)] tracking-wider">Instituições de Ensino</h4>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => append({ tipo: "GRADUACAO", instituicao: "", integra_ranking_40: false })} className="flex items-center gap-1 text-[10px] bg-white border border-[var(--border)] px-2 py-1 rounded hover:bg-[var(--bg)] transition">
                          <Plus className="w-3 h-3" /> Graduação
                        </button>
                        <button type="button" onClick={() => append({ tipo: "POS", instituicao: "", integra_ranking_40: false })} className="flex items-center gap-1 text-[10px] bg-white border border-[var(--border)] px-2 py-1 rounded hover:bg-[var(--bg)] transition">
                          <Plus className="w-3 h-3" /> Pós-Graduação
                        </button>
                      </div>
                    </div>
                    {fields.map((field, index) => (
                      <div key={field.id} className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-[var(--bg)] p-3 rounded-lg border border-[var(--border)]">
                        <div className="md:col-span-2">
                          <label className="block text-[10px] font-bold text-[var(--text-muted)] mb-1 uppercase">Instituição ({watch(`vinculos_docentes.${index}.tipo`)})</label>
                          <input {...register(`vinculos_docentes.${index}.instituicao`)} className="w-full px-3 py-1.5 border rounded-lg outline-none text-sm" placeholder="Ex: USP, IDP..." />
                        </div>
                        <div className="flex items-center pt-4">
                          <label className="flex items-center gap-2 text-xs cursor-pointer">
                            <input type="checkbox" {...register(`vinculos_docentes.${index}.integra_ranking_40`)} />
                            Integra Ranking 40+?
                          </label>
                        </div>
                        <div className="flex items-center justify-end pt-4">
                          <button type="button" onClick={() => remove(index)} className="text-red-500 hover:text-red-700 transition p-1">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {fields.length === 0 && (
                      <p className="text-center py-6 text-xs text-[var(--text-muted)] italic border border-dashed rounded-lg">
                        Nenhuma instituição adicionada. Use os botões acima para adicionar.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section>
              <h3 className="font-serif italic text-lg text-[var(--text-main)] mb-4 border-b pb-2">Titulação</h3>
              <div className="space-y-6">
                <label className="flex items-center gap-2 text-sm font-bold bg-[var(--nav-hover)] p-3 rounded-lg"><input type="checkbox" {...register("especialista")} /> É especialista (lato sensu)?</label>

                <div className="border border-[var(--border)] rounded-lg p-4">
                  <label className="flex items-center gap-2 text-sm font-bold mb-4"><input type="checkbox" {...register("mestre")} /> É mestre?</label>
                  {is_mestre && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2"><label className="text-xs font-bold block mb-1">Título da Dissertação</label><input {...register("titulo_mestrado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Ano de publicação</label><input type="number" {...register("ano_mestrado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Faculdade/IES</label><input {...register("faculdade_mestrado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Área de concentração</label><input {...register("area_mestrado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Link de acesso (público)</label><input {...register("link_mestrado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                    </div>
                  )}
                </div>

                <div className="border border-[var(--border)] rounded-lg p-4">
                  <label className="flex items-center gap-2 text-sm font-bold mb-4"><input type="checkbox" {...register("doutora")} /> É doutora?</label>
                  {is_doutora && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2"><label className="text-xs font-bold block mb-1">Título da Tese</label><input {...register("titulo_doutorado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Ano de publicação</label><input type="number" {...register("ano_doutorado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Faculdade/IES</label><input {...register("faculdade_doutorado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Área de concentração</label><input {...register("area_doutorado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Link de acesso (público)</label><input {...register("link_doutorado")} className="w-full px-3 py-2 border rounded-lg" /></div>
                    </div>
                  )}
                </div>

                <div className="border border-[var(--border)] rounded-lg p-4">
                  <label className="flex items-center gap-2 text-sm font-bold mb-4"><input type="checkbox" {...register("livre_docente")} /> É livre-docente?</label>
                  {is_livre_docente && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="md:col-span-2"><label className="text-xs font-bold block mb-1">Título da Tese</label><input {...register("titulo_livre_docencia")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Ano de publicação</label><input type="number" {...register("ano_livre_docencia")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Faculdade/IES</label><input {...register("faculdade_livre_docencia")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Área de concentração</label><input {...register("area_livre_docencia")} className="w-full px-3 py-2 border rounded-lg" /></div>
                      <div><label className="text-xs font-bold block mb-1">Link de acesso (público)</label><input {...register("link_livre_docencia")} className="w-full px-3 py-2 border rounded-lg" /></div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {camposExtras.length > 0 && (
              <section>
                <h3 className="font-serif italic text-lg text-[var(--text-main)] mb-4 border-b pb-2">Outras Informações (Campos Extras)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[var(--row-hover)] p-4 rounded-lg">
                  {camposExtras.map((c: any) => (
                    <div key={c.id}>
                      <label className="block text-xs font-bold text-[var(--text-muted)] mb-1">{c.label}</label>
                      {c.tipo === "boolean" ? (
                        <input type="checkbox" {...register(c.nome_campo)} className="mt-2" />
                      ) : (
                        <input type={c.tipo === "number" ? "number" : "text"} {...register(c.nome_campo)} className="w-full px-3 py-2 border border-[var(--border)] rounded-lg outline-none focus:ring-1 focus:ring-[var(--accent)]" />
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="pt-4 flex items-center justify-end space-x-4 border-t border-[var(--border)] mt-8">
              <button type="button" disabled={isSubmitting} onClick={handleSubmit(onSubmitManual)} className="px-5 py-2.5 bg-[var(--accent)] text-white font-semibold rounded-lg hover:bg-[var(--accent-hover)] transition-colors shadow-sm">
                Salvar Registro (Aba 1)
              </button>
            </div>

          </form>
        </div>
      )}

      {tab === "PRODUCAO" && (
        <div className="bg-white p-8 rounded-xl border border-[var(--border)] shadow-sm">
          <ProducaoForm />
        </div>
      )}
    </div>
  );
};
