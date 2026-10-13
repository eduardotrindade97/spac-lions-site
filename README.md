# SPAC Lions SVNS 2026 — site do campeonato

Site público (times/atletas) + painel do organizador, com banco de dados em
tempo real. Zero custo de hospedagem nesse tamanho de evento — o único gasto
real é um domínio próprio, se e quando você quiser um (R$40–90/ano).

- **Site público:** `index.html` — Início, Cronograma, Grupos, Placares, e
  (dentro de "Mais") Regulamento, Artilharia, Times, Enviar súmula, Avisos.
- **Painel do organizador:** `admin/index.html` — uma página separada, com
  login próprio. Só quem você cadastrar como usuário no Firebase consegue
  entrar e editar qualquer coisa.
- **Importação dos times:** `admin/migrate.html` — roda uma vez só, carrega
  os 17 times que já estavam cadastrados no Claude.

Nenhum dos dois (`index.html` e `admin/index.html`) precisa de build, npm ou
compilador — é HTML/CSS/JS puro, os únicos lugares que dão trabalho são os
passos abaixo (feitos uma vez, em painéis visuais, sem escrever código).

---

## Passo 1 — Criar o projeto no Firebase (grátis)

1. Acesse **console.firebase.google.com** e entre com uma conta Google (pode
   ser a sua pessoal ou uma conta nova só pro torneio).
2. **Adicionar projeto** → nome, por exemplo, `spac-lions-2026` → pode
   desativar o Google Analytics (não precisa) → Criar projeto.
3. No menu lateral, **Compilação → Firestore Database** → **Criar banco de
   dados** → modo produção → escolha a região `southamerica-east1 (São
   Paulo)` → Ativar.
4. **Compilação → Authentication** → **Começar** → na aba "Sign-in method",
   ative **E-mail/senha**.
5. Ainda em Authentication, aba **Users** → **Add user** → cadastre o e-mail
   e senha de cada pessoa que vai administrar o painel (você, e quem mais
   quiser). Pra adicionar mais gente depois, é só voltar aqui — sem precisar
   mexer em nada no código.

## Passo 2 — Conectar o site ao seu projeto Firebase

1. No Firebase, clique no ⚙️ ao lado de "Visão geral do projeto" → **Config.
   do projeto**.
2. Em "Seus apps", clique no ícone **`</>`** (Web) → dê um apelido (ex:
   `spac-lions-web`) → **Registrar app** (não precisa do Firebase Hosting).
3. Ele mostra um bloco `firebaseConfig = {...}`. Copie os valores e cole em
   **`js/firebase-config.js`**, substituindo cada `"COLE_AQUI"`.

## Passo 3 — Publicar as regras de segurança

Essa regra é o que garante que qualquer visitante só consegue ver e enviar
súmula/escudo, e que só quem fez login no painel consegue editar time, jogo,
placar e avisos.

1. Firestore Database → aba **Regras** → apague o conteúdo e cole o de
   **`firestore.rules`** (está neste projeto) → **Publicar**.

> Não usamos o Firebase Storage de propósito — o Google passou a exigir
> cadastrar um cartão (plano "Blaze") só pra habilitar o Storage, mesmo no
> uso gratuito. Pra não precisar disso, o escudo de cada time é comprimido
> no próprio navegador do representante do clube e guardado como imagem
> pequena direto no Firestore (campo `logoUrl` do time). Zero cartão, zero
> custo, funciona igual pro usuário final.

## Passo 4 — Publicar o site (Vercel, grátis)

1. Crie uma conta em **github.com** (se ainda não tiver) e uma em
   **vercel.com** (pode entrar direto com a conta do GitHub).
2. No GitHub, crie um repositório novo (pode ser privado) e suba esta pasta
   inteira (dá pra fazer isso direto pela interface do GitHub, arrastando os
   arquivos em "Add file → Upload files" — não precisa saber git).
3. Na Vercel: **Add New → Project** → selecione o repositório que você
   acabou de criar → em "Framework Preset" deixe **Other** → não precisa
   configurar build command nem output directory → **Deploy**.
4. Em 1-2 minutos a Vercel te dá um link tipo
   `https://spac-lions-2026.vercel.app`. Esse é o link do site público. O
   painel fica em `https://spac-lions-2026.vercel.app/admin/`.

Quando quiser um domínio próprio (ex: `spaclions.com.br`), é só comprar em
qualquer registrador e, na Vercel, ir em **Project → Settings → Domains** e
seguir o passo a passo de lá (leva uns minutos, é só apontar o DNS).

## Passo 5 — Importar os 17 times já cadastrados

1. Depois do site publicado, acesse
   `https://SEU-SITE.vercel.app/admin/migrate.html`.
2. Faça login com um dos e-mails de admin que você cadastrou no Passo 1.
3. Clique em **"Importar times agora"**. Isso cria os 17 times de uma vez
   (mesmos nomes e categorias que já estavam no Claude). Rodar de novo não
   duplica nada — só atualiza.

Pronto — o site está no ar, com o painel admin funcionando e os dados
migrados.

---

## Uso do dia a dia

- **Adicionar/editar jogos, times, atletas, avisos:** tudo pelo painel
  `/admin/`, aba correspondente.
- **Lançar placar ao vivo:** aba "Placar ao vivo" — escolha o jogo, e toque
  nos botões de pontuação dos atletas (puxados automaticamente da súmula
  aprovada daquele time). Atualiza na hora pra quem estiver no site.
- **Aprovar súmula enviada por um time:** aba "Súmulas".
- **Time enviando o próprio escudo:** na aba "Times" do site público, o
  próprio representante do clube toca em "enviar escudo" — não precisa de
  login nenhum pra isso.
- **Adicionar mais um admin:** Firebase Console → Authentication → Users →
  Add user. Pronto, essa pessoa já consegue entrar em `/admin/`.
- **Mudar a data/hora da contagem regressiva:** edite a constante
  `EVENT_DATE` em `js/firebase-init.js` e publique o arquivo de novo (no
  GitHub, editar e salvar já redispara o deploy automático na Vercel).

## Por que essa arquitetura

- **Firestore** (banco de dados do Firebase) entrega tempo real de verdade:
  qualquer alteração no painel admin aparece no site público na hora, sem
  recarregar a página.
- **Regras do Firestore** são aplicadas no servidor do Google, não no
  navegador — ou seja, mesmo que alguém tente mexer "por fora" da interface
  (abrindo o console do navegador), só quem estiver autenticado como admin
  consegue escrever nas coleções restritas.
- **Sem Firebase Storage, sem cartão cadastrado:** o Google exige plano
  pago (Blaze) só pra habilitar o Storage, mesmo dentro da faixa grátis.
  Contornamos isso comprimindo o escudo no navegador e guardando como
  imagem pequena no próprio Firestore — nenhuma etapa deste projeto pede
  cartão de crédito.
- **Vercel** hospeda arquivos estáticos de graça, com HTTPS automático e
  deploy automático toda vez que você atualiza o código no GitHub.
- Tudo dentro da faixa gratuita do Firebase/Vercel pro volume de um
  campeonato (dezenas de times, algumas centenas de visitas por dia) — seu
  orçamento de R$100–200 fica livre pra um domínio próprio, se quiser.
