const BT8_LEGAL_UPDATED_AT = '29 de abril de 2026';
const BT8_LEGAL_CNPJ = '53.243.248/0001-40';

function legalRouteKey() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/direitos-do-sistema') return 'rights';
  if (path === '/termos-de-uso') return 'terms';
  if (path === '/politica-de-privacidade') return 'privacy';
  return null;
}

function legalNav() {
  return `
    <nav class="lnav legal-nav">
      <a class="legal-brand" href="/bt8" aria-label="Voltar para BT8">
        <img id="legal-nav-logo" class="lnav-logo" src="" alt="BT8" onload="this.classList.add('loaded')">
      </a>
      <div class="legal-nav-actions">
        <a href="/bt8">Conhecer o BT8</a>
        <button class="lnav-btn" onclick="openAuthModal('login')">Entrar</button>
      </div>
    </nav>`;
}

function legalFooter() {
  return `
    <div class="lfooter legal-page-footer">
      <div>BT8 é uma marca vinculada ao CNPJ ${BT8_LEGAL_CNPJ}.</div>
      <div class="legal-footer-links">
        <a href="/direitos-do-sistema">Direitos do sistema</a>
        <a href="/termos-de-uso">Termos de uso</a>
        <a href="/politica-de-privacidade">Política de privacidade</a>
      </div>
      <div class="legal-footer-cnpj">Última atualização: ${BT8_LEGAL_UPDATED_AT}</div>
    </div>`;
}

const LEGAL_PAGES = {
  rights: {
    title: 'Direitos do sistema',
    description: 'Informações sobre marca, propriedade intelectual e licença de uso do BT8.',
    intro: 'Esta página explica os direitos relacionados ao BT8, sua marca, identidade visual, funcionamento do sistema e materiais associados.',
    sections: [
      ['Titularidade e marca', [
        `BT8 é uma marca vinculada ao CNPJ ${BT8_LEGAL_CNPJ}.`,
        'O nome BT8, seus elementos visuais, telas, textos, fluxos, identidade, organização de informações e materiais de comunicação pertencem aos seus titulares e são protegidos pela legislação aplicável.'
      ]],
      ['Software e propriedade intelectual', [
        'O BT8 é um sistema digital para gestão de torneios de beach tennis. O acesso ao sistema não transfere ao usuário qualquer direito de propriedade sobre código-fonte, banco de dados, arquitetura, layout, lógica de funcionamento, marca ou identidade visual.',
        'É proibido copiar, clonar, vender, sublicenciar, distribuir, modificar, reproduzir, explorar comercialmente ou criar produtos derivados do BT8 sem autorização formal e por escrito.'
      ]],
      ['Licença de uso', [
        'Ao usar o BT8, o usuário recebe uma licença limitada, pessoal, revogável e não exclusiva para utilizar o sistema dentro das funcionalidades disponibilizadas no plano contratado ou gratuito.',
        'Essa licença existe apenas enquanto o usuário respeitar os Termos de Uso, os limites do plano e as regras de conduta da plataforma.'
      ]],
      ['Uso da marca', [
        'O usuário não pode usar a marca BT8, logotipo, elementos visuais ou materiais comerciais como se fossem próprios, nem sugerir parceria, franquia, representação ou autorização oficial sem consentimento.',
        'Prints do sistema podem ser compartilhados para divulgação de torneios, rankings e resultados gerados pelo próprio usuário, desde que não sejam usados para copiar ou revender o sistema.'
      ]],
      ['Violação de direitos', [
        'Qualquer tentativa de engenharia reversa, extração automatizada, cópia de interface, reprodução de funcionalidades para produto concorrente ou uso indevido da marca poderá levar ao bloqueio de acesso e adoção das medidas legais cabíveis.'
      ]]
    ]
  },
  terms: {
    title: 'Termos de uso',
    description: 'Regras de uso do BT8, planos, pagamentos, cancelamento e responsabilidades.',
    intro: 'Ao acessar ou utilizar o BT8, você concorda com estes Termos de Uso. Leia com atenção antes de criar torneios, cadastrar conta ou contratar planos pagos.',
    sections: [
      ['1. Sobre o BT8', [
        'O BT8 é uma ferramenta digital para criar, organizar e acompanhar torneios de beach tennis, incluindo modalidades rotativas, duplas fixas, duplas aleatórias, placares, ranking e histórico.',
        `BT8 é uma marca vinculada ao CNPJ ${BT8_LEGAL_CNPJ}.`
      ]],
      ['2. Cadastro e conta', [
        'Para salvar histórico, contratar planos pagos ou acessar recursos vinculados a uma conta, o usuário deve informar dados verdadeiros e manter seu e-mail acessível.',
        'O usuário é responsável por proteger sua senha, seu acesso e as ações realizadas na própria conta.'
      ]],
      ['3. Teste sem cadastro e plano Free', [
        'O BT8 pode permitir teste sem cadastro, com limite de uso definido pelo sistema. Torneios criados sem conta podem não ser salvos no histórico.',
        'O plano Free permite uso gratuito com limites mensais de torneios salvos e pode ter recursos reduzidos em relação aos planos Pro.'
      ]],
      ['4. Planos pagos', [
        'O Pro 30 Dias libera recursos Pro por período determinado, mediante pagamento único e sem renovação automática.',
        'O Pro Mensal é uma assinatura recorrente. O usuário pode cancelar a recorrência e continuar usando o acesso Pro até a data já paga ou até a data em que ocorreria a próxima cobrança.',
        'Quando permitido, o usuário com Pro 30 Dias pode assinar o Pro Mensal antes do vencimento. Nesse caso, a cobrança recorrente mensal começa apenas após o fim do período vigente.'
      ]],
      ['5. Pagamentos e processamento', [
        'Pagamentos são processados por provedor externo, como Stripe. O BT8 não armazena dados completos de cartão de crédito.',
        'Valores, períodos, descontos e condições comerciais podem ser alterados para novas contratações, sempre respeitando o ciclo já contratado quando aplicável.'
      ]],
      ['6. Cancelamento e exclusão de conta', [
        'O cancelamento da recorrência interrompe cobranças futuras, mas não remove automaticamente o acesso já pago.',
        'Ao excluir a conta, o usuário perde acesso ao histórico, dados salvos e eventual direito de uso Pro vinculado àquela conta, mesmo que ainda existisse período pago remanescente.'
      ]],
      ['7. Uso adequado', [
        'É proibido usar o BT8 para fraudes, abuso de limites, ataque ao sistema, tentativa de invasão, engenharia reversa, scraping não autorizado ou violação de direitos de terceiros.',
        'O BT8 pode suspender ou encerrar acessos em caso de uso indevido, risco de segurança ou violação destes termos.'
      ]],
      ['8. Disponibilidade e limitações', [
        'O BT8 busca oferecer uma experiência estável, mas não garante disponibilidade ininterrupta, ausência total de erros ou compatibilidade com todos os dispositivos, navegadores e condições de rede.',
        'O sistema auxilia a organização de torneios, mas a conferência de jogadores, placares, regras locais e decisões esportivas permanece sob responsabilidade do organizador.'
      ]],
      ['9. Alterações nos termos', [
        'Estes Termos de Uso podem ser atualizados para refletir mudanças no produto, nas regras comerciais ou em exigências legais. A data de atualização ficará indicada nesta página.'
      ]]
    ]
  },
  privacy: {
    title: 'Política de privacidade',
    description: 'Como o BT8 coleta, usa, armazena e protege dados pessoais e informações de uso.',
    intro: 'Esta Política de Privacidade explica quais dados o BT8 coleta, por que eles são usados e quais controles o usuário possui sobre suas informações.',
    sections: [
      ['1. Dados coletados', [
        'Podemos coletar dados informados pelo usuário, como nome, e-mail, telefone, data de nascimento, sexo, cidade, estado e avatar.',
        'Também podemos armazenar dados de uso do sistema, como torneios criados, modalidades, jogadores inseridos pelo organizador, placares, rankings, histórico, plano ativo e eventos técnicos de navegação.'
      ]],
      ['2. Dados de pagamento', [
        'Pagamentos são processados por provedor externo, como Stripe. O BT8 recebe apenas informações necessárias para liberar ou cancelar acesso, como status do pagamento, tipo de plano, identificadores de cliente e assinatura.',
        'O BT8 não armazena número completo de cartão, código de segurança ou dados sensíveis completos de pagamento.'
      ]],
      ['3. Finalidades de uso', [
        'Os dados são usados para criar e autenticar contas, salvar histórico, liberar planos, processar suporte, prevenir abuso, melhorar o produto e manter segurança operacional.',
        'Eventos de uso podem ser analisados de forma agregada para entender recursos mais usados, limites atingidos, falhas e evolução do MVP.'
      ]],
      ['4. Serviços terceiros', [
        'O BT8 pode utilizar provedores essenciais para operar o produto, incluindo Supabase para autenticação e banco de dados, Stripe para pagamentos e Netlify para hospedagem e funções.',
        'Esses provedores tratam dados conforme suas próprias políticas e somente na medida necessária para prestação dos serviços.'
      ]],
      ['5. Cookies e armazenamento local', [
        'O BT8 pode usar localStorage, sessionStorage e tecnologias semelhantes para manter sessão, lembrar intenção de checkout, controlar teste sem cadastro, melhorar navegação e reduzir fricção no uso.',
        'A remoção desses dados no navegador pode afetar login, teste sem cadastro ou continuidade de fluxos.'
      ]],
      ['6. Compartilhamento', [
        'O BT8 não vende dados pessoais. Dados podem ser compartilhados com operadores técnicos essenciais, por obrigação legal, para defesa de direitos ou para prevenir fraude e abuso.'
      ]],
      ['7. Segurança e retenção', [
        'Adotamos medidas técnicas e organizacionais compatíveis com o estágio do produto para proteger informações contra acesso indevido, perda ou alteração não autorizada.',
        'Dados podem ser mantidos enquanto a conta estiver ativa, enquanto forem necessários para operação, cumprimento legal, auditoria, prevenção de fraude ou defesa de direitos.'
      ]],
      ['8. Direitos do usuário', [
        'O usuário pode solicitar acesso, correção ou exclusão de dados, conforme a legislação aplicável.',
        'O app possui fluxo de exclusão de conta. Ao excluir a conta, dados de perfil e acesso são removidos ou desativados conforme necessidade técnica, legal e operacional.'
      ]],
      ['9. Contato e atualizações', [
        `Dúvidas sobre privacidade, termos ou direitos do sistema podem ser direcionadas ao responsável pela marca vinculada ao CNPJ ${BT8_LEGAL_CNPJ}.`,
        'Esta política pode ser atualizada conforme o produto evoluir. A versão vigente será sempre a publicada nesta página.'
      ]]
    ]
  }
};

function renderLegalSections(sections) {
  return sections.map(([heading, paragraphs]) => `
    <section class="legal-section">
      <h2>${heading}</h2>
      ${paragraphs.map(text => `<p>${text}</p>`).join('')}
    </section>
  `).join('');
}

function renderLegalPage() {
  const key = legalRouteKey();
  if (!key) return;
  const page = LEGAL_PAGES[key];
  const main = document.getElementById('lp-main');
  const landing = document.getElementById('screen-landing');
  if (!page || !main || !landing) return;

  document.title = `${page.title} | BT8`;
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', page.description);
  landing.classList.add('active');

  main.innerHTML = `
    ${legalNav()}
    <main class="legal-page">
      <section class="legal-hero lp-s visible-init">
        <span class="bt8-kicker">BT8 Institucional</span>
        <h1>${page.title}</h1>
        <p>${page.intro}</p>
        <div class="legal-meta">Última atualização: ${BT8_LEGAL_UPDATED_AT}</div>
      </section>
      <article class="legal-content lp-s visible-init">
        ${renderLegalSections(page.sections)}
      </article>
    </main>
    ${legalFooter()}
  `;

  const appLogo = document.querySelector('#screen-home .topbar-logo');
  const navLogo = document.getElementById('legal-nav-logo');
  if (appLogo && navLogo) navLogo.src = appLogo.src;
}

document.addEventListener('DOMContentLoaded', renderLegalPage);
