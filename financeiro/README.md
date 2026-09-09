# Caixa — controle financeiro pessoal

Painel financeiro que roda inteiramente no navegador. Sem backend, sem build, sem dependências externas: basta abrir o `index.html`.

## Como executar

Abra `index.html` com dois cliques. Funciona em `file://`, por isso os módulos usam scripts clássicos em vez de ES modules (que exigiriam um servidor local).

Na primeira execução alguns lançamentos de exemplo são carregados para o painel não abrir vazio. Remova-os em **Dados → Limpar dados de demonstração**.

## Estrutura

```
financeiro/
├── index.html          estrutura da página e modais
├── css/style.css       tokens de cor, layout e responsividade
└── js/
    ├── utils.js        formatação (R$ e datas), cálculo de meses, helpers de DOM
    ├── storage.js      única camada que fala com o localStorage
    ├── transactions.js regras de negócio: criar, parcelar, editar, excluir, filtrar
    ├── charts.js       gráficos em SVG puro (barras, rosca e linha)
    ├── dashboard.js    cálculos do mês e renderização do painel e da visão futura
    ├── ui.js           modais, formulário, tabela, avisos e confirmações
    └── app.js          estado da aplicação, eventos e integração dos módulos
```

Os módulos são carregados nessa ordem e se comunicam pelo objeto global `FIN`. Cada um tem uma responsabilidade só: `storage` não conhece regras, `transactions` não toca no DOM, `dashboard` e `ui` não gravam dados.

## Modelo de dados

Cada lançamento salvo em `caixa:v1:transactions`:

```js
{
  id: "tx_m0x1_ab12cd",
  type: "despesa",              // "receita" | "despesa"
  description: "Notebook Dell",
  amount: 100,                  // valor DESTA parcela
  date: "2026-11-14",           // vencimento desta parcela
  category: "Trabalho",
  paymentMethod: "Inter (J)",
  installment: {                // null quando não é parcelado
    current: 3,
    total: 12,
    groupId: "grp_m0x1_ef34gh", // liga as parcelas da mesma compra
    totalAmount: 1200           // valor cheio da compra
  },
  demo: false,
  createdAt: "2026-09-08T12:00:00.000Z"
}
```

Uma compra em 12x gera 12 registros, um por mês. Como cada mês enxerga apenas a sua parcela, o resumo mensal nunca é distorcido pelo valor cheio da compra.

Outras chaves: `caixa:v1:prefs` (tema e ordenação) e `caixa:v1:meta` (controle da carga de demonstração).

## Detalhes que valem conhecer

- **Centavos**: o total é dividido em centavos inteiros e a sobra vai para as primeiras parcelas. R$ 100 em 3x vira 33,34 + 33,33 + 33,33 — a soma sempre fecha.
- **Datas**: exibidas e digitadas como `DD-MM-AAAA`. O campo tem máscara própria (o `input type="date"` nativo segue o idioma do sistema e às vezes mostra `MM/DD/AAAA`), com um botão de calendário ao lado que abre o seletor do sistema e devolve a data já formatada. Internamente tudo é guardado como texto `YYYY-MM-DD`, que ordena e compara corretamente, sem `new Date(string)` e sem problema de fuso. Dia 31 em mês curto cai no último dia do mês.
- **Editar uma parcela**: o formulário pergunta se a alteração vale só para aquela parcela ou para a compra inteira. No segundo caso o grupo é recriado com o mesmo `groupId`, sem duplicar nada.
- **Excluir uma parcela**: a confirmação oferece apagar só a parcela ou a compra toda.
- **Gráficos**: SVG gerado à mão, com `viewBox` menor em telas estreitas para o texto não encolher. Sem Chart.js — nada é baixado da internet, então funciona offline.
- **Backup**: exporte e importe um `.json` em **Dados**.

## Atalhos

| Tecla | Ação |
| --- | --- |
| `N` | novo lançamento |
| `←` `→` | mês anterior / próximo |
| `Esc` | fecha o modal aberto |
| clique no nome do mês | volta para o mês atual |

## Para adicionar uma categoria

Inclua o nome em `FIN.Config.categories` (em `js/utils.js`), a cor em `categoryColors` e a variável correspondente no `:root` do CSS. Nada mais precisa mudar.
