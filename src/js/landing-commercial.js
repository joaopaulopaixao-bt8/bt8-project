function isCommercialLandingRoute() {
  return window.location.pathname.replace(/\/+$/, '') === '/bt8';
}

function bt8PrimaryCta(source, options = {}) {
  if (typeof trackEvent === 'function') trackEvent('signup_started', { source: source || 'bt8_landing' });
  if (typeof openAuthModal === 'function') openAuthModal('signup', options);
}

function bt8TryNow() {
  if (typeof trackEvent === 'function') trackEvent('guest_try_started', { source: 'bt8_landing' });
  if (typeof startWithoutLogin === 'function') startWithoutLogin();
}

function bt8GoPlans() {
  const root = document.getElementById('lp-main') || document.getElementById('screen-landing');
  const target = document.getElementById('bt8-plans');
  if (root && target) root.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
}

function bt8PlanCta(plan) {
  if (SUPA_USER && typeof startCheckout === 'function') {
    startCheckout(plan);
    return;
  }
  if (typeof savePendingCheckoutIntent === 'function') {
    savePendingCheckoutIntent(plan, 'bt8_landing_paid_plan');
  }
  bt8PrimaryCta(plan === 'pro_monthly' ? 'bt8_landing_monthly' : 'bt8_landing_30d', { preserveCheckoutIntent: true });
}

function renderCommercialLanding() {
  if (!isCommercialLandingRoute()) return;
  const main = document.getElementById('lp-main');
  if (!main) return;

  document.title = 'BT8 | Torneios de Beach Tennis em minutos';
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.setAttribute('content', 'Crie torneios de beach tennis, gere rodadas, lance placares e acompanhe ranking pelo celular com o BT8.');

  main.innerHTML = `
    <nav class="lnav bt8-nav">
      <div class="lnav-left">
        <img id="lp-nav-logo" class="lnav-logo" src="" alt="BT8" onload="this.classList.add('loaded')">
      </div>
      <div class="bt8-nav-actions">
        <button class="lnav-btn" onclick="bt8GoPlans()">Planos</button>
        <button class="lnav-btn bt8-nav-primary" onclick="openAuthModal('login')">Entrar</button>
      </div>
    </nav>

    <section class="bt8-hero lp-s visible-init">
      <div class="bt8-hero-photo"></div>
      <div class="bt8-hero-shade"></div>
      <div class="bt8-hero-inner">
        <div class="bt8-hero-copy">
          <div class="bt8-eyebrow">Beach tennis sem planilha</div>
          <h1>Crie torneios em minutos, sem travar a quadra.</h1>
          <p class="bt8-hero-sub">O BT8 monta rodadas, organiza confrontos, recebe placares e atualiza o ranking ao vivo direto no celular.</p>
          <div class="bt8-cta-row">
            <button class="bt8-cta-primary" onclick="bt8TryNow()">Testar sem cadastro</button>
            <button class="bt8-cta-secondary" onclick="bt8GoPlans()">Ver planos</button>
          </div>
          <div class="bt8-proof-row">
            <span>1 torneio grátis sem cadastro</span>
            <span>Conta Free disponível</span>
            <span>Pro para organizadores frequentes</span>
          </div>
        </div>
        <div class="bt8-phone-wrap" aria-label="Mockup do BT8">
          <div class="bt8-phone">
            <div class="bt8-phone-top">
              <span>SUPER 8</span>
              <strong>2/14 jogos</strong>
            </div>
            <div class="bt8-round-card active">
              <div class="bt8-round-title">RODADA 1</div>
              <div class="bt8-game-row done">
                <span class="bt8-game-tag">01</span>
                <div><b>João<br>Marcos</b></div>
                <em>VS</em>
                <div>Jorge<br>Ray</div>
                <strong>6 x 5</strong>
              </div>
              <div class="bt8-winner">João + Marcos</div>
              <div class="bt8-game-row done">
                <span class="bt8-game-tag">02</span>
                <div>Messi<br>Lucas</div>
                <em>VS</em>
                <div><b>Spoto<br>Talysson</b></div>
                <strong>5 x 6</strong>
              </div>
              <div class="bt8-winner">Spoto + Talysson</div>
            </div>
            <div class="bt8-live-rank">
              <span></span> RANKING AO VIVO
            </div>
            ${['João','Marcos','Spoto','Talysson','Jorge','Ray'].map((name, i) => `
              <div class="bt8-rank-line">
                <b>${i < 3 ? ['1º','2º','3º'][i] : (i + 1) + 'º'}</b>
                <span>${name}</span>
                <strong>${i < 4 ? '1 pts' : '0 pts'}</strong>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="bt8-proof-strip lp-s">
      <div><strong>Super 4 a Super 12</strong><span>formatos prontos</span></div>
      <div><strong>Duplas fixas e aleatórias</strong><span>com regras guiadas</span></div>
      <div><strong>Ranking compartilhável</strong><span>sem refazer conta</span></div>
    </section>

    <section class="bt8-section bt8-problem lp-s">
      <div class="bt8-section-copy">
        <span class="bt8-kicker">O problema real</span>
        <h2>O torneio não quebra por falta de jogo. Quebra na organização.</h2>
        <p>Quando tudo fica em papel, planilha ou conversa de WhatsApp, alguém sempre precisa parar para conferir rodada, dupla, descanso, placar e ranking.</p>
      </div>
      <div class="bt8-pain-grid">
        <div><b>Quem joga agora?</b><span>A rodada vira pergunta repetida.</span></div>
        <div><b>Quem descansou?</b><span>O equilíbrio some no improviso.</span></div>
        <div><b>Qual foi o placar?</b><span>Resultado perdido muda ranking.</span></div>
        <div><b>Quem ganhou?</b><span>O final fica menos claro do que deveria.</span></div>
      </div>
    </section>

    <section class="bt8-image-band lp-s">
      <img src="./img/problem.jpg" alt="Jogadores de beach tennis em contexto de torneio">
      <div>
        <span class="bt8-kicker">A virada</span>
        <h2>O organizador sai da planilha e volta para a quadra.</h2>
        <p>O BT8 guia o fluxo inteiro: escolhe formato, valida participantes, gera jogos, recebe placares e mostra ranking. Menos comando manual, mais torneio acontecendo.</p>
      </div>
    </section>

    <section class="bt8-section lp-s">
      <span class="bt8-kicker">Como funciona</span>
      <h2>Um fluxo simples para quem precisa resolver rápido.</h2>
      <div class="bt8-steps">
        <div><strong>1</strong><b>Escolha a modalidade</b><span>Super 4, 6, 8, 12, mistas, duplas fixas ou aleatórias.</span></div>
        <div><strong>2</strong><b>Cadastre jogadores</b><span>O app mostra o que falta e evita combinações inválidas.</span></div>
        <div><strong>3</strong><b>Gere e acompanhe</b><span>Rodadas, placares e ranking ficam no celular.</span></div>
      </div>
    </section>

    <section class="bt8-section bt8-formats lp-s">
      <span class="bt8-kicker">Não é uma tabela genérica</span>
      <h2>O BT8 já entende os formatos que a galera joga.</h2>
      <div class="bt8-format-grid">
        ${[
          ['Super 4', '4 jogadores, 3 rodadas, rápido para grupo pequeno.'],
          ['Super 8', '7 rodadas, todos os pares, ideal para duas quadras.'],
          ['Super 12', 'grupo maior, mais jogos, mesma lógica guiada.'],
          ['Super Mista', 'homens e mulheres em combinações rotativas.'],
          ['Duplas Fixas', 'duplas prontas em Round Robin.'],
          ['Duplas Aleatorias', 'o sistema sorteia as duplas automaticamente.']
        ].map(([title, text]) => `<div><b>${title}</b><span>${text}</span></div>`).join('')}
      </div>
    </section>

    <section class="bt8-human lp-s">
      <img src="./img/social.jpg" alt="Jogadores reunidos depois de uma partida">
      <div class="bt8-human-card">
        <span class="bt8-kicker">Para grupos, professores e arenas</span>
        <h2>Uma experiência mais profissional, mesmo no torneio entre amigos.</h2>
        <p>Quando a rodada aparece clara e o ranking atualiza na hora, o grupo confia mais no torneio. E você organiza sem precisar ser a planilha ambulante do dia.</p>
      </div>
    </section>

    <section class="bt8-section bt8-benefits lp-s">
      <span class="bt8-kicker">Benefícios do Pro</span>
      <h2>Quando organizar vira rotina, o Pro paga pelo tempo que devolve.</h2>
      <div class="bt8-benefit-grid">
        <div><b>Torneios ilimitados</b><span>Para quem organiza toda semana ou toca eventos com frequência.</span></div>
        <div><b>Histórico completo</b><span>Consulte torneios antigos e preserve resultados importantes.</span></div>
        <div><b>Ranking pronto para compartilhar</b><span>Menos print confuso, mais resultado bonito no grupo.</span></div>
        <div><b>Cancelamento justo</b><span>No mensal, cancelar para a próxima cobrança mantém o acesso até o fim do ciclo.</span></div>
      </div>
    </section>

    <section class="bt8-section bt8-plans lp-s" id="bt8-plans">
      <span class="bt8-kicker">Escolha como começar</span>
      <h2>Teste grátis, use Free ou libere o Pro.</h2>
      <div class="bt8-plan-grid">
        <div class="bt8-plan">
          <span>Teste avulso</span>
          <h3>R$ 0</h3>
          <p>Para experimentar agora, sem criar conta.</p>
          <ul><li>1 torneio grátis por mês</li><li>Sem histórico salvo</li><li>Ideal para sentir o app</li></ul>
          <button onclick="bt8TryNow()">Testar sem cadastro</button>
        </div>
        <div class="bt8-plan">
          <span>Free</span>
          <h3>R$ 0</h3>
          <p>Para uso ocasional com conta criada.</p>
          <ul><li>Conta gratuita</li><li>Histórico limitado</li><li>Bom para torneios pontuais</li></ul>
          <button onclick="bt8PrimaryCta('bt8_landing_free')">Criar conta grátis</button>
        </div>
        <div class="bt8-plan featured">
          <small>Mais indicado</small>
          <span>Pro Mensal</span>
          <h3>R$ 6,90<em>/mês</em></h3>
          <p>Para professores, grupos e organizadores recorrentes.</p>
          <ul><li>Torneios ilimitados</li><li>Histórico completo</li><li>Cancele quando quiser</li></ul>
          <button id="btn-checkout-monthly" onclick="bt8PlanCta('pro_monthly')">Assinar Pro Mensal</button>
        </div>
        <div class="bt8-plan">
          <span>Pro 30 Dias</span>
          <h3>R$ 14,90</h3>
          <p>Para evento, temporada curta ou teste completo.</p>
          <ul><li>Pagamento único</li><li>30 dias de Pro</li><li>Sem renovação automática</li></ul>
          <button id="btn-checkout-30d" onclick="bt8PlanCta('pro_30d')">Comprar 30 Dias</button>
        </div>
      </div>
      <div id="plans-msg" class="bt8-plans-msg"></div>
    </section>

    <section class="bt8-section bt8-faq lp-s">
      <span class="bt8-kicker">Dúvidas comuns</span>
      <h2>Antes de criar seu primeiro torneio.</h2>
      <details open><summary>Preciso criar conta para testar?</summary><p>Não. Você pode gerar 1 torneio grátis por mês sem cadastro. Para salvar histórico, crie conta.</p></details>
      <details><summary>O plano Free é grátis mesmo?</summary><p>Sim. Ele serve para uso ocasional, com limite mensal de torneios salvos.</p></details>
      <details><summary>O Pro 30 Dias renova sozinho?</summary><p>Não. É pagamento único. Se quiser, você pode assinar o mensal e deixar a cobrança começar no vencimento dos 30 dias.</p></details>
      <details><summary>Se eu cancelar o mensal, perco acesso na hora?</summary><p>Não. O Pro segue ativo até a data em que a próxima cobrança aconteceria.</p></details>
    </section>

    <section class="bt8-final lp-s" id="lp-cta-final">
      <div>
        <span class="bt8-kicker">Comece agora</span>
        <h2>Seu próximo torneio não precisa nascer numa planilha.</h2>
        <p>Teste o BT8 agora e veja a tabela, os placares e o ranking aparecendo no celular.</p>
        <button class="bt8-cta-primary" onclick="bt8TryNow()">Criar meu primeiro torneio</button>
      </div>
    </section>

    <div class="lsticky bt8-sticky" id="lp-sticky">
      <button class="lsticky-cta" onclick="bt8TryNow()">Testar sem cadastro</button>
      <div class="lsticky-row">
        <button class="lsticky-secondary" onclick="bt8GoPlans()">Ver planos</button>
        <div class="lsticky-note">Free, Pro Mensal e Pro 30 Dias</div>
      </div>
    </div>
    <div class="lfooter">
      <div>BT8 · Torneios de Beach Tennis · /bt8</div>
      <div class="legal-footer-links">
        <a href="/direitos-do-sistema">Direitos do sistema</a>
        <a href="/termos-de-uso">Termos de uso</a>
        <a href="/politica-de-privacidade">Política de privacidade</a>
      </div>
      <div class="legal-footer-cnpj">BT8 é uma marca vinculada ao CNPJ 53.243.248/0001-40.</div>
    </div>
  `;

  const appLogo = document.querySelector('#screen-home .topbar-logo');
  const navLogo = document.getElementById('lp-nav-logo');
  if (appLogo && navLogo) navLogo.src = appLogo.src;

  if (typeof initLandingObserver === 'function') initLandingObserver();
  if (typeof initStickyCtaObserver === 'function') initStickyCtaObserver();
}

document.addEventListener('DOMContentLoaded', renderCommercialLanding);
