# Landing vendedora dos planos BT8 Pro

Objetivo: clonar a landing atual e criar uma segunda versao focada em conversao para os planos pagos, sem mexer na entrada principal do app ate validarmos a copy.

## Rota proposta

- Landing atual: `/`
- Nova landing vendedora: `/pro` ou `/planos`
- CTA principal: abrir cadastro/login e, depois do login, abrir o modal de planos.

## Publico

- Organizadores de torneios pequenos de beach tennis, clubes, professores e jogadores que organizam grupos.
- Pessoas que ja entenderam o BT8 como ferramenta e precisam decidir se vale pagar pelo Pro.

## Promessa central

Organize torneios de beach tennis em minutos, salve o historico e acompanhe ranking, jogos e resultados sem planilha.

## Estrutura da pagina

1. Hero direto para venda
   - Headline: "BT8 Pro: torneios ilimitados, historico salvo e ranking pronto para compartilhar"
   - Subheadline: "Para quem organiza torneios com frequencia e quer parar de refazer tabela, ranking e controle de jogos na mao."
   - CTAs: "Assinar Pro Mensal" e "Comprar Pro 30 Dias"

2. Dor antes do produto
   - "Quando o torneio cresce, a planilha vira gargalo."
   - Pontos: sorteio manual, ranking confuso, perda de historico, dificuldade de compartilhar resultado.

3. Beneficios Pro
   - Torneios ilimitados.
   - Historico completo.
   - Ranking e imagem para compartilhar.
   - Fluxos para Super 4, 6, 8, 12, mistas, duplas fixas e aleatorias.

4. Comparativo Free x Pro
   - Free: bom para testar e torneios ocasionais.
   - Pro Mensal: melhor para organizadores recorrentes.
   - Pro 30 Dias: ideal para evento, temporada curta ou teste completo.

5. Planos
   - Pro Mensal: R$ 6,90/mes, recorrente, pode cancelar e continua ativo ate o fim do ciclo.
   - Pro 30 Dias: R$ 14,90 uma vez, acesso Pro por 30 dias.
   - Destaque: quem tem Pro 30 Dias pode agendar o mensal para comecar so no vencimento.

6. Prova de uso
   - Cards com exemplos: "Torneio de grupo", "Aula/evento", "Clube pequeno".
   - Mostrar capturas ou mockups reais do app: chave, ranking e historico.

7. FAQ curta
   - "Perco meu historico se o Pro acabar?" Nao.
   - "Posso cancelar o mensal?" Sim, e continua valido ate o fim do periodo pago.
   - "O Pro 30 Dias vira mensal sozinho?" Nao, apenas se o usuario assinar o mensal.

## Implementacao tecnica

- Reaproveitar `screen-landing` como base visual.
- Criar um bloco HTML separado para a landing vendedora, preferencialmente em `src/index.html` com rota detectada por JS.
- Adicionar redirect Netlify para `/pro` ou `/planos` apontando para `index.html`.
- Criar funcoes de CTA:
  - Visitante: abrir cadastro.
  - Usuario logado Free: abrir modal de planos.
  - Admin: bloquear assinatura e mostrar que Admin nao assina planos.

## Criterio de aceite

- `/` continua como landing/app atual.
- `/pro` ou `/planos` abre a landing vendedora.
- CTAs levam ao cadastro/login ou modal de planos.
- Layout mobile primeiro, com precos visiveis na primeira rolagem.
- Nenhuma chave secreta ou regra de pagamento fica no front.
