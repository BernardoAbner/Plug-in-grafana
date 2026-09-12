# Base de cards configuráveis

## Como usar

1. Em **Métricas → Seleção de métricas**, escolha **Configurável**.
2. Clique em **Adicionar métrica** e selecione um campo das consultas retornadas.
3. Configure rótulo, ícone, alinhamento horizontal/vertical e badge de cada métrica.
4. Use **Subir/Descer** para ordenar e **Remover** para excluir uma métrica da exibição.
5. Em **Layout**, escolha cards separados ou métricas no mesmo card, orientação, espaçamentos, largura mínima e arredondamento.

Para status dinâmico, escolha **Valor formatado / mapeado** no badge e configure os mapeamentos de valor e thresholds do campo. Ative **Usar cor de threshold** para aplicar a cor ao status. Um badge de texto fixo não infere o estado da métrica.

## Estrutura

- `src/components/SimplePanel.tsx`: renderização, formatação Grafana e cores.
- `src/components/MetricsEditor.tsx`: editor visual da lista de métricas.
- `src/module.ts`: registro das opções de painel e campo.
- `src/types.ts`: esquema de opções, configuração e referência de métricas.
- `src/metrics.ts`: catálogo de campos e resolução das referências.

## Compatibilidade e limites

O modo automático permanece padrão e mantém os campos numéricos/textuais da primeira série, na ordem original. O último valor da série continua sendo usado, inclusive quando nulo. Unidades, decimais, mapeamentos, temas e thresholds continuam usando o processamento existente.

As referências configuradas combinam consulta, nome do frame, nome do campo e ocorrência. A ordem de consultas com identidades distintas pode mudar. Frames indistinguíveis usam a ordem de ocorrência; renomear uma consulta/frame/campo pode exigir selecionar o campo novamente. Campos ausentes permanecem visíveis como indisponíveis. Não há associação automática por host ou agrupamento por linha nesta base.

O alinhamento horizontal posiciona o conteúdo dentro do bloco da métrica. O vertical usa o espaço disponível no bloco; painéis baixos ou muitas métricas podem precisar de rolagem. A orientação controla linha/coluna; a largura mínima controla a quebra de linha.

Os tipos legados `ColumnDisplayType` e `ValueAlignment` foram restaurados porque `TableView.tsx` ainda os importa, embora não seja o componente registrado pelo plugin.

## Validação

Executar `npm run typecheck`, `npm run test:ci`, ESLint nos arquivos alterados e `npm run build` (webpack original). Os testes de unidade cobrem compatibilidade, referências, duplicatas, ausência de dados, limites e renderização. Os testes de navegador antigos referenciam um painel diferente e precisam de revisão antes de serem usados como aceite. A validação no Grafana em execução permanece necessária para conferir o resultado com consultas reais.
