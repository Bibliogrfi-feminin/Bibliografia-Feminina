// ==UserScript==
// @name         BPF — Coleta Lattes
// @namespace    https://bibliografia-feminina-mu.vercel.app
// @version      1.0.0
// @description  Envia o currículo Lattes aberto pelo portal da Bibliografia Processual Feminina de volta ao portal. Não resolve captcha nem abre nada sozinho.
// @match        *://buscatextual.cnpq.br/buscatextual/visualizacv.do*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
 * O que este script faz, e só isso:
 *
 *  1. Roda apenas na página de currículo do Lattes, e apenas quando ela foi
 *     aberta pela tela "Coleta Lattes" do portal (window.opener).
 *  2. Enquanto a página mostra o captcha, avisa o portal e espera. Quem
 *     resolve o captcha é a pessoa.
 *  3. Quando o currículo aparece, manda o HTML da página para o portal. A
 *     leitura dos dados acontece no portal (src/lib/lattes.ts).
 *
 * O portal, depois de gravar, leva esta mesma aba para o próximo currículo
 * da fila. Aberta fora do portal, a página fica como está.
 */
(function () {
  "use strict";

  // Só estas origens recebem a página. Mudou o endereço do portal, mude aqui.
  var PORTAIS = [
    "https://bibliografia-feminina-mu.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ];

  var opener = window.opener;
  if (!opener) return;

  function enviar(msg) {
    msg.origem = "bpf-coleta-lattes";
    msg.versao = 1;
    // postMessage com origem que não confere é descartado pelo navegador
    // sem erro: só a janela do portal de verdade recebe
    PORTAIS.forEach(function (o) {
      try { opener.postMessage(msg, o); } catch (e) { /* janela fechada */ }
    });
  }

  function ehCurriculo() {
    return !!document.querySelector("h2.nome") && !!document.querySelector('a[name="Identificacao"], a[name="FormacaoAcademicaTitulacao"]');
  }

  var faixa;
  function avisar(texto, cor) {
    if (!faixa) {
      faixa = document.createElement("div");
      faixa.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px 16px;" +
        "font:600 14px/1.4 system-ui,sans-serif;color:#fff;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25)";
      document.documentElement.appendChild(faixa);
    }
    faixa.style.background = cor;
    faixa.textContent = texto;
  }

  var enviado = false;
  function tentar() {
    if (enviado) return true;
    if (!ehCurriculo()) return false;
    enviado = true;
    avisar("BPF: currículo enviado ao portal. Aguardando…", "#6b4e9b");
    enviar({ tipo: "curriculo", url: location.href, html: document.documentElement.outerHTML });
    return true;
  }

  window.addEventListener("message", function (e) {
    if (PORTAIS.indexOf(e.origin) < 0 || !e.data || e.data.origem !== "bpf-portal") return;
    if (e.data.tipo === "gravado") avisar("BPF: " + (e.data.texto || "gravado.") , "#2e7d32");
    if (e.data.tipo === "erro") avisar("BPF: " + (e.data.texto || "erro ao gravar."), "#c62828");
  });

  if (!tentar()) {
    enviar({ tipo: "captcha", url: location.href });
    avisar("BPF: resolva o captcha para continuar a coleta.", "#b26a00");
    // depois do captcha a página costuma recarregar; se o currículo vier
    // por troca de conteúdo, o observador pega
    var obs = new MutationObserver(function () { if (tentar()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
