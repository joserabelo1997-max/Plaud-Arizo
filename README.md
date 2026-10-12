# Escuta

App web para iPhone que transcreve e resume as gravações do Plaud Note, sem assinatura.

- **Transcrição:** ElevenLabs Scribe v2, com o vocabulário (nomes e termos em inglês e japonês) enviado junto, e identificação de quem fala.
- **Correções, resumos e perguntas:** Claude. As correções só aceitam grafias que estão no vocabulário, e cada item do resumo aponta o trecho do áudio e passa por uma conferência.
- **Onde fica tudo:** neste aparelho (IndexedDB do Safari). As chaves das APIs também ficam só no aparelho. Não há servidor.

## Instalar no iPhone

1. Abra o endereço do GitHub Pages no Safari.
2. Toque em Compartilhar › Adicionar à Tela de Início.
3. Abra pelo ícone e cole as chaves em Eu › Chaves.

## Arquivos

`index.html`, `styles.css`, `app.js` (todo o app), `sw.js` (abre sem internet), `manifest.webmanifest` e ícones. Sem etapa de build: o GitHub Pages serve os arquivos como estão.
