# Skill: Deploy BT8 no Netlify

## Como fazer deploy

1. Gerar o zip com os arquivos:
```bash
zip -j BT8-deploy.zip src/index.html public/manifest.json public/sw.js public/_headers public/_redirects
```

2. Acessar https://app.netlify.com
3. Ir no site **bt8.com.br**
4. Arrastar o zip na área de deploy

## Estrutura do zip
```
BT8-deploy.zip
├── index.html      ← app completo
├── manifest.json   ← PWA manifest
├── sw.js           ← Service Worker
├── _headers        ← headers Netlify
└── _redirects      ← redirects Netlify
```

## Observações
- Não há processo de build — arquivos estáticos puros
- O Service Worker faz cache do app para uso offline
- O manifest configura o app como instalável (PWA)
