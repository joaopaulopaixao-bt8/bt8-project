# BT8 — Beach Tennis Tournament Manager

PWA de gerenciamento de torneios de beach tennis.

🌐 **https://bt8.com.br**

## Início rápido

```bash
# Abrir o app localmente (sem build)
open src/index.html
# ou simplesmente arrastar o arquivo no navegador
```

## Deploy

```bash
# PowerShell: gerar uma pasta pronta para arrastar no Netlify
Remove-Item -Recurse -Force dist -ErrorAction SilentlyContinue
New-Item -ItemType Directory dist | Out-Null
Copy-Item src\* dist -Recurse
Copy-Item public\* dist
# Arrastar a pasta dist no Netlify
```

## Documentação

- `docs/CONTEXT.md` — arquitetura completa, banco de dados, modos de torneio
- `CLAUDE.md` — instruções para o Claude Code
- `.claude/skills/` — skills de frontend, Supabase e deploy

## Stack

- HTML/CSS/JS vanilla
- Supabase (auth + banco)
- Netlify (hosting)
- PWA (manifest + service worker)
